'use server';

import { db } from '@/server/db';
import { chatMessages, chatSessions } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import { randomUUID } from 'crypto';

// O AI SDK (ai@6) gera IDs curtos não-UUID (ex: "U8UCATCzvJbfSUGT").
// A coluna chat_messages.id é UUID — precisamos garantir formato válido.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUUID(id: string | undefined): string {
  if (id && UUID_REGEX.test(id)) return id;
  return randomUUID();
}

// O AI SDK (ai@6) serializa tool results no formato ModelMessage como {type:'json', value:{...}}.
// Ao salvar via response.messages e recarregar do DB, o campo `result` pode ter esse envelope.
// Esta função desempacota de volta para o valor bruto esperado pelo ChatMessageItem.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapToolResult(result: any): any {
  if (result && typeof result === 'object' && result.type === 'json' && 'value' in result) {
    return result.value;
  }
  return result;
}

// Converte um toolInvocation salvo no banco para parte de UIMessage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invocationToToolPart(
  ti: any,
  defaultState: 'output-available' | 'input-available' = 'input-available'
): any {
  const state =
    ti.state === 'result'
      ? 'output-available'
      : ti.state === 'call'
        ? 'input-available'
        : ti.state === 'partial-call'
          ? 'input-streaming'
          : defaultState;

  return {
    type: `tool-${ti.toolName}`,
    toolName: ti.toolName,
    toolCallId: ti.toolCallId,
    state,
    input: ti.args ?? {},
    ...(state === 'output-available' ? { output: unwrapToolResult(ti.result) } : {}),
  };
}

export async function getChatMessages(chatId: string): Promise<UIMessage[]> {
  // Fase 1 (P-01): busca por chatId (nova arquitetura)
  let dbMessages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.createdAt));

  // Retrocompat: se vazio, tenta buscar pelo queryId antigo (mensagens pre-Fase 1)
  if (dbMessages.length === 0) {
    dbMessages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.queryId, chatId))
      .orderBy(asc(chatMessages.createdAt));
  }

  const finalMessages: UIMessage[] = [];

  for (const msg of dbMessages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invocations = (msg.toolInvocations as any[]) || [];

    if (msg.role === 'tool') {
      // No UIMessage não existe role 'tool' — resultados ficam nas parts do assistant
      const prevAssistant = finalMessages[finalMessages.length - 1];
      if (prevAssistant && prevAssistant.role === 'assistant') {
        invocations.forEach((ti: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matchIdx = prevAssistant.parts.findIndex(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (p: any) => p.type?.startsWith('tool-') && p.toolCallId === ti.toolCallId
          );
          const newPart = invocationToToolPart(ti, 'output-available');
          if (matchIdx >= 0) {
            prevAssistant.parts[matchIdx] = newPart;
          } else {
            prevAssistant.parts.push(newPart);
          }
        });
      }
      continue;
    }

    // Filtra roles inválidos para UIMessage
    const role = msg.role as string;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];

    if (typeof msg.content === 'string' && msg.content) {
      parts.push({ type: 'text', text: msg.content });
    }

    // Adiciona partes de tool call/result das invocations
    for (const ti of invocations) {
      parts.push(invocationToToolPart(ti));
    }

    finalMessages.push({
      id: msg.id,
      role: role as 'user' | 'assistant' | 'system',
      parts,
    });
  }

  return finalMessages;
}

export async function saveChatMessages(
  chatId: string,
  messages: Array<{
    id?: string;
    role: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: string | any[];
    // UIMessage format (ai@6): parts[] em vez de content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolInvocations?: any;
  }>,
  queryId?: string | null
) {
  if (!messages || messages.length === 0) return;

  const toInsert = messages.map((m) => {
    let normalizedContent = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalToolInvocations: any[] = m.toolInvocations ? [...m.toolInvocations] : [];

    // Suporte a UIMessage (ai@6): usa parts[] se content for undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentSrc: string | any[] | undefined = m.content ?? (m.parts ? m.parts : undefined);

    if (typeof contentSrc === 'string') {
      normalizedContent = contentSrc;
    } else if (Array.isArray(contentSrc)) {
      const textParts = [];
      for (const part of contentSrc) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'tool-call') {
          finalToolInvocations.push({
            state: 'call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.input ?? part.args,
          });
        } else if (part.type === 'tool-result') {
          finalToolInvocations.push({
            state: 'result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: (part.input ?? part.args) || {},
            result: part.output ?? part.result,
          });
        } else if (part.type?.startsWith('tool-')) {
          // UIMessage tool parts (ex: "tool-propose_search_sol_database")
          finalToolInvocations.push({
            state: part.state === 'output-available' ? 'result' : 'call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.input ?? {},
            ...(part.state === 'output-available' ? { result: part.output } : {}),
          });
        } else {
          textParts.push(typeof part === 'string' ? part : JSON.stringify(part));
        }
      }
      normalizedContent = textParts.join('\n');
    } else if (contentSrc) {
      normalizedContent = JSON.stringify(contentSrc);
    }

    return {
      id: ensureUUID(m.id),
      chatId, // Fase 1 (P-01): chave primária de sessão
      queryId: queryId ?? null, // Fase 1: nullable, vincula à query ativa
      role: m.role,
      content: normalizedContent,
      toolInvocations: finalToolInvocations.length > 0 ? finalToolInvocations : null,
    };
  });

  // We use insert().onConflictDoNothing() in case we are trying to save an already saved message from the client array over time
  // Wait, standard insert without conflict needs a unique constraint on ID to avoid throwing.
  // Since we use the message IDs from Vercel AI SDK, we can rely on onConflictDoNothing.
  await db.insert(chatMessages).values(toInsert).onConflictDoNothing({ target: chatMessages.id });
}

/**
 * Fase 1 (P-01): Cria uma nova sessão de chat e retorna o chatId.
 * É chamado uma vez no início do workspace, antes do primeiro envio.
 */
export async function createChatSession(userId: string | null): Promise<string> {
  const [session] = await db
    .insert(chatSessions)
    .values({
      userId: userId ?? null,
    })
    .returning({ id: chatSessions.id });

  if (!session) throw new Error('Falha ao criar chat session no banco de dados.');
  return session.id;
}

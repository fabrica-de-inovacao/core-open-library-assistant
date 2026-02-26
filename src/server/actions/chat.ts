'use server';

import { db } from '@/server/db';
import { chatMessages } from '@/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import { Message } from 'ai/react';
import { randomUUID } from 'crypto';

export async function getChatMessages(queryId: string): Promise<Message[]> {
  const dbMessages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.queryId, queryId))
    .orderBy(asc(chatMessages.createdAt));

  return dbMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'system' | 'user' | 'assistant' | 'data',
    content: msg.content,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolInvocations: msg.toolInvocations as any, // Restore Vercel AI SDK tool payload
  }));
}

export async function saveChatMessages(
  queryId: string,
  messages: Array<{
    id?: string;
    role: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: string | any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolInvocations?: any;
  }>
) {
  if (!messages || messages.length === 0) return;

  const toInsert = messages.map((m) => {
    let normalizedContent = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalToolInvocations: any[] = m.toolInvocations ? [...m.toolInvocations] : [];

    if (typeof m.content === 'string') {
      normalizedContent = m.content;
    } else if (Array.isArray(m.content)) {
      const textParts = [];
      for (const part of m.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'tool-call') {
          finalToolInvocations.push({
            state: 'call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args,
          });
        } else if (part.type === 'tool-result') {
          // Attaching tool results so useChat can render the 'result' state
          finalToolInvocations.push({
            state: 'result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args || {},
            result: part.result,
          });
        } else {
          textParts.push(typeof part === 'string' ? part : JSON.stringify(part));
        }
      }
      normalizedContent = textParts.join('\\n');
    } else if (m.content) {
      normalizedContent = JSON.stringify(m.content);
    }

    // Ensure we don't save empty string if it's purely a tool call message
    if (!normalizedContent && finalToolInvocations.length > 0) {
      normalizedContent = '';
    }

    return {
      id: m.id || randomUUID(),
      queryId,
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

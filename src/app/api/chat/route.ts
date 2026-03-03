/* eslint-disable @typescript-eslint/no-explicit-any */
import { streamText, stepCountIs, convertToModelMessages, generateText } from 'ai';
import { auth } from '@/auth';
import { getModelForTask, getModelIdForTask, getModelById } from '@/lib/ai-provider';
import { db } from '@/server/db';
import { articles, searchQueries, chatSessions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { saveChatMessages } from '@/server/actions/chat';
import { logger } from '@/lib/logger';
import {
  buildProposeSearchSolDatabaseTool,
  buildProposeSearchGlobalDatabaseTool,
  buildAddArticleByDoiTool,
  buildGenerateSystematicReviewTool,
} from '@/server/tools';

// Allow streaming responses up to 60 seconds (search + LLM synthesis)
// Síntese via SynthesisAgent pode levar até ~90s (LLM com thinking budget).
export const maxDuration = 120;

// ─── History Compression Helpers ────────────────────────────────────────────

/**
 * Converte tool calls relevantes do histórico em linhas de texto compacto.
 * Operação determinística — sem custo LLM.
 */
function describeToolCalls(messages: any[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const part of (m.parts ?? []) as any[]) {
      if (!part.type?.startsWith('tool-')) continue;
      if (part.state !== 'output-available') continue;
      const toolName: string = part.toolName ?? '';
      const input: any = part.input ?? {};
      const output: any = part.output ?? {};
      if (toolName === 'propose_search_sol_database') {
        // input.queries é array — exibe a primeira string como preview do tópico
        const queriesArr: string[] = Array.isArray(input.queries) ? input.queries : [];
        const preview = (queriesArr[0] ?? String(input.topic ?? '')).slice(0, 80);
        const qId = (output.query_id ?? '').slice(0, 8);
        lines.push(
          `- Busca SOL: "${preview}"${queriesArr.length > 1 ? ` (+${queriesArr.length - 1})` : ''}${qId ? ` [qid:${qId}…]` : ''}`
        );
      } else if (toolName === 'propose_search_global_database') {
        const q = String(input.query ?? '').slice(0, 80);
        const qId = (output.query_id ?? '').slice(0, 8);
        lines.push(`- Busca Global (OpenAlex): "${q}"${qId ? ` [qid:${qId}…]` : ''}`);
      } else if (toolName === 'generate_systematic_review') {
        lines.push(`- Revisão sistemática gerada e entregue ao usuário.`);
      } else if (toolName === 'add_article_by_doi') {
        lines.push(`- Artigo adicionado via DOI: ${input.doi ?? '?'}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Comprime mensagens antigas em texto de contexto.
 * - Tool calls → deterministicamente (zero custo LLM)
 * - Texto livre → sumarizado por modelo rápido/barato
 */
async function compressMessages(oldMessages: any[], summarizerModel: any): Promise<string> {
  const toolBlock = describeToolCalls(oldMessages);

  const textPairs: string[] = [];
  for (const m of oldMessages) {
    const textPart = (m.parts ?? []).find((p: any) => p.type === 'text');
    if (!textPart?.text?.trim()) continue;
    const onlyToolParts = (m.parts ?? []).every(
      (p: any) => p.type?.startsWith('tool-') || (p.type === 'text' && !p.text?.trim())
    );
    if (onlyToolParts) continue; // mensagem só de tool — já captada em toolBlock
    const prefix = m.role === 'user' ? 'Usuário' : 'Assistente';
    textPairs.push(`${prefix}: ${String(textPart.text).slice(0, 300)}`);
  }

  if (!toolBlock && textPairs.length === 0) return '';

  // Sem texto livre → apenas bloco determinístico, sem chamar o LLM
  if (textPairs.length === 0) {
    return `**Ações anteriores:**\n${toolBlock}`;
  }

  const conversationRaw = textPairs.join('\n');
  const { text: textSummary } = await generateText({
    model: summarizerModel,
    prompt: `Resuma o trecho de conversa abaixo em NO MÁXIMO 100 palavras em Português do Brasil. Preserve tópicos principais, perguntas do usuário e insights relevantes. Sem preâmbulos.\n\n${conversationRaw}`,
  });

  const parts: string[] = [];
  if (toolBlock) parts.push(`**Ações anteriores:**\n${toolBlock}`);
  parts.push(`**Resumo da conversa anterior:**\n${textSummary.trim()}`);
  return parts.join('\n\n');
}

/**
 * Quando o histórico ultrapassa MAX_HISTORY_MESSAGES:
 * V2: Lê summary cacheado do DB — regenera via LLM apenas quando necessário.
 *   - cachedSummary presente + não vencido  → zero custo LLM, ~0ms extra.
 *   - cachedSummary ausente ou vencido      → chama gemini-1.5-flash (~200–400ms).
 * Vence quando: messages.length - cachedSummaryMsgCount >= KEEP_RECENT (14).
 */
async function compressHistoryIfNeeded(
  messages: any[],
  summarizerModel: any,
  cachedSummary: string | null = null,
  cachedSummaryMsgCount = 0
): Promise<{
  messages: any[];
  compressed: boolean;
  originalCount: number;
  newSummary: string | null; // non-null = novo resumo gerado, deve ser salvo no DB
  newSummaryMsgCount: number; // quantas mensagens cobriu o novo resumo
}> {
  const MAX_HISTORY_MESSAGES = 22;
  const KEEP_RECENT = 14;
  // Cache permanece válido enquanto há menos de REFRESH_THRESHOLD novas mensagens
  // fora da janela "recent" desde a última sumarização. Evita chamar o LLM de resumo
  // a cada troca de mensagem (o que causava cache=MISS constante e +500ms/request).
  const REFRESH_THRESHOLD = 8;

  if (messages.length <= MAX_HISTORY_MESSAGES) {
    return {
      messages,
      compressed: false,
      originalCount: messages.length,
      newSummary: null,
      newSummaryMsgCount: 0,
    };
  }

  const recent = messages.slice(-KEEP_RECENT);
  const summaryCoversUpTo = messages.length - KEEP_RECENT; // índice final coberto pelo resumo ideal

  // Cache válido se: existe E a diferença entre o que ficou de fora e o que cobre é pequena
  const uncoveredSinceCache = summaryCoversUpTo - cachedSummaryMsgCount;
  const cacheValid = !!cachedSummary && uncoveredSinceCache < REFRESH_THRESHOLD;

  let summaryText: string;
  let newSummary: string | null = null;
  let newSummaryMsgCount = cachedSummaryMsgCount;

  if (cacheValid) {
    summaryText = cachedSummary!;
  } else {
    // Gera novo resumo cobrindo TUDO antes da janela "recent" (inclui msgs ainda não cobertas)
    const old = messages.slice(0, summaryCoversUpTo);
    summaryText = await compressMessages(old, summarizerModel);
    // Se o LLM retornou vazio mas existia cache anterior, mantém o cache (não perde contexto)
    if (!summaryText && cachedSummary) summaryText = cachedSummary;
    newSummary = summaryText || null;
    newSummaryMsgCount = summaryCoversUpTo;
  }

  const injected: any[] = [];
  if (summaryText) {
    injected.push({
      id: 'ctx-summary',
      role: 'user' as const,
      parts: [
        {
          type: 'text',
          text: `[CONTEXTO — MENSAGENS ANTERIORES COMPRIMIDAS]\n${summaryText}`,
        },
      ],
    });
    injected.push({
      id: 'ctx-summary-ack',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'Compreendido. Tenho o contexto das interações anteriores.' }],
    });
  }

  return {
    messages: [...injected, ...recent],
    compressed: true,
    originalCount: messages.length,
    newSummary,
    newSummaryMsgCount,
  };
}

// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // P-02: obter userId da sessão para vincular searchQueries ao utilizador
  const session = await auth();
  const sessionUserId = session?.user?.id ?? null;

  const { messages, queryId, chatId, modelId: requestedModelId } = await req.json();

  // Fase 1 (P-01): Garante que a chat_session existe no DB para o chatId recebido.
  // O cliente gera o UUID localmente (otimista) e a primeira request cria o registro.
  // V2: Lê o cache de sumarização quando o histórico já é longo (evita SELECT desnecessário).
  let cachedSummary: string | null = null;
  let cachedSummaryCount = 0;
  if (chatId) {
    await db
      .insert(chatSessions)
      .values({ id: chatId, userId: sessionUserId })
      .onConflictDoNothing({ target: chatSessions.id });

    if (messages.length > 22) {
      const [sessionRow] = await db
        .select({
          conversationSummary: chatSessions.conversationSummary,
          conversationSummaryCount: chatSessions.conversationSummaryCount,
        })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatId))
        .limit(1);
      cachedSummary = sessionRow?.conversationSummary ?? null;
      cachedSummaryCount = sessionRow?.conversationSummaryCount ?? 0;
    }
  }

  const modifiedMessages = [...messages];

  const systemPromptOverride = `Você é o SOL Assistant, um pesquisador sênior em Ciência da Computação especializado em revisão sistemática de literatura acadêmica.

**══ REGRA ABSOLUTA — SAÍDA DA REVISÃO SISTEMÁTICA ══**
Quando a ferramenta \`generate_systematic_review\` retornar \`success: true\` com um campo \`review\` preenchido, a sua resposta DEVE ser EXATAMENTE o conteúdo literal do campo \`review\`, copiado palavra por palavra, sem NENHUMA alteração.
PROIBIDO totalmente: preâmbulos, comentários, análises, ressalvas, observações sobre contagem de artigos, menções a discrepâncias ou qualquer texto que não seja o próprio conteúdo de \`review\`.
Comece sua resposta diretamente na primeira linha do campo \`review\` (que inicia com \`# 📚\`).
Esta regra tem PRIORIDADE MÁXIMA sobre qualquer raciocínio ou observação que você possa fazer.

**FLUXO PADRÃO — sessão SEM artigos (início de conversa ou sessão vazia):**
Quando não há artigos processados na sessão E o usuário faz qualquer pergunta ou menciona qualquer tema acadêmico/científico, CHAME IMEDIATAMENTE \`propose_search_sol_database\`. Não pergunte se o usuário quer pesquisar — apenas proponha a busca diretamente. Esta é a função principal da plataforma.
Exceção: saudações puras ("oi", "olá", "tudo bem?") sem conteúdo temático → responda brevemente apresentando a plataforma e aguarde.

**FLUXO DE BUSCA — quando o usuário PEDIR explicitamente uma nova pesquisa (sessão com ou sem artigos):**
1. Chame SEMPRE \`propose_search_sol_database\` primeiro — é a base de dados principal do sistema.
2. Ao chamar \`propose_search_sol_database\`: passe APENAS \`topic\` com o tema em linguagem natural e \`queries: []\` (array vazio). NÃO elabore strings booleanas — o agente de estratégia especializado as gerará automaticamente.
3. Após retorno de \`propose_search_sol_database\`, escreva APENAS uma frase curta confirmando (ex.: "Estratégia de busca pronta — revise as strings se necessário e clique em **Executar** quando estiver pronto."). PARE imediatamente.
   - EXCEÇÃO: se você estiver chamando \`propose_search_global_database\` porque o [SISTEMA] indicou que a busca SOL não retornou resultados, escreva 2 frases explicando a situação ao usuário (SOL sem resultados → propondo OpenAlex). Não use apenas o texto genérico de confirmação.
4. Não repita uma proposta se já houver uma no histórico — aguarde o usuário clicar em Executar.
- NUNCA chame \`propose_search_global_database\` na primeira interação de busca. Use SOMENTE quando: (a) o sistema informar explicitamente que a busca SOL retornou poucos resultados (≤ 5), ou (b) o usuário pedir EXPLICITAMENTE busca global, OpenAlex, ACM ou IEEE.
- NUNCA liste strings de busca no corpo do texto. Elas só existem dentro das ferramentas.

**FLUXO DE CONVERSA — quando já há artigos na sessão E o usuário faz uma pergunta sobre eles:**
- Responda com base nos artigos e na revisão já gerados nesta sessão.
- Se os dados disponíveis forem insuficientes para responder à pergunta com precisão, diga isso claramente em UMA frase E em seguida ofereça-se explicitamente para ampliar a pesquisa (ex.: "Gostaria que eu buscasse artigos sobre esse aspecto específico?").
- NÃO chame ferramentas de busca automaticamente — só chame se o usuário confirmar que quer mais artigos.

**REGRAS GERAIS:**
- Responda OBRIGATORIAMENTE em Português do Brasil.
- Seja conciso — frases curtas, sem preâmbulos desnecessários.
- NOMES PRÓPRIOS (projetos, programas, siglas, instituições — ex: "Sereias Digitais", "ProInfo", "ENEM"): NUNCA os traduza. Para buscas na SOL, preserve o nome original entre aspas duplas. Para buscas globais (OpenAlex), NOMES PRÓPRIOS EM PORTUGUÊS não aparecem na literatura internacional — traduza para os CONCEITOS em inglês que o projeto representa (ex: "Mermãs Digitais" → "digital inclusion women computing education").`;

  // Contexto dinâmico: injetado no system prompt quando há uma sessão de busca ativa.
  let fallbackInstruction = '';
  if (queryId) {
    const [qData] = await db
      .select({ status: searchQueries.status, originalQuery: searchQueries.originalQuery })
      .from(searchQueries)
      .where(eq(searchQueries.id, queryId))
      .limit(1);

    if (qData?.status === 'done') {
      const queryArticles = await db.select().from(articles).where(eq(articles.queryId, queryId));
      const doneArticles = queryArticles.filter(
        (a) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      // Monta mini-bibliografia para contexto do chat pós-revisão
      const bibliographySummary = doneArticles
        .map(
          (a, i) =>
            `[${i + 1}] "${a.title}" — ${a.authors ?? 'Autores N/A'} (${a.publicationYear ?? 'Ano N/A'})` +
            (a.doi ? ` DOI: ${a.doi}` : '') +
            (a.tldrContent ? `\n    TL;DR: ${a.tldrContent.slice(0, 200)}` : '')
        )
        .join('\n');

      fallbackInstruction = `

**CONTEXTO DA SESSÃO ATUAL:**
O usuário já tem uma revisão sistemática gerada para a query: "${qData.originalQuery ?? queryId}".
Foram encontrados ${doneArticles.length} artigos processados nesta sessão.

**MODO CONVERSA SOBRE A BIBLIOGRAFIA:**
Você agora atua como assistente de pesquisa contextualizado na bibliografia da sessão. Você pode:
- Responder perguntas sobre os artigos encontrados, suas metodologias, resultados e limitações
- Aprofundar análises comparativas entre artigos
- Explicar conceitos mencionados na revisão
- Sugerir gaps de pesquisa e oportunidades de investigação
- Ajudar a formatar citações ou referências

**REGRA DE NOVAS BUSCAS:**
Quando o usuário pedir uma nova busca ou quiser AMPLIAR o acervo, chame \`propose_search_sol_database\` (padrão). Só use \`propose_search_global_database\` se o usuário pedir EXPLICITAMENTE busca global/OpenAlex. Isso INCREMENTA o acervo existente — não substitui.

**ARTIGOS DISPONÍVEIS NESTA SESSÃO (resumo para contexto):**
${bibliographySummary || 'Nenhum artigo listado.'}`;

      // Aviso adicional se poucos resultados
      if (doneArticles.length <= 5) {
        fallbackInstruction += `\n\n**AVISO:** Poucos artigos encontrados na base SOL (<= 5). Se adequado, sugira ao usuário ampliar a busca para a base global (**OpenAlex**) chamando \`propose_search_global_database\`.`;
      }
    }
  }

  // P-22: usa o modelo solicitado pelo cliente (se fornecido) ou o padrão da task
  const modelId =
    typeof requestedModelId === 'string' && requestedModelId
      ? requestedModelId
      : getModelIdForTask('orchestrator');
  const orchestratorModel =
    typeof requestedModelId === 'string' && requestedModelId
      ? getModelById(requestedModelId)
      : getModelForTask('orchestrator');

  logger.info('[Chat] ── request ──────────────────────────');
  logger.info('[Chat] messages count :', modifiedMessages.length);
  logger.info('[Chat] activeQueryId  :', queryId ?? 'none');
  logger.info('[Chat] modelo         :', modelId);
  logger.info('[Chat] LOG_MODE       :', process.env.LOG_MODE ?? '(não definido → development)');

  // P-15 FIX: mensagens [SISTEMA] NÃO são mais filtradas — o AI precisa vê-las para
  // executar ferramentas como generate_systematic_review. O prefixo [SISTEMA] é
  // apenas removido antes de enviar ao modelo (o cliente já filtra para display).
  // NOTA: filtrar por completo causava o AI retornar 0 tokens (reason=stop) porque
  // ele não via nenhuma instrução nova na última mensagem da conversa.
  const messagesForModel = modifiedMessages.map((m: any) => {
    if (m.role !== 'user') return m;
    const textPart = m.parts?.find((p: any) => p.type === 'text');
    if (!textPart?.text?.startsWith('[SISTEMA]')) return m;
    // Strip prefixo — AI vê a instrução limpa
    return {
      ...m,
      parts: m.parts.map((p: any) =>
        p.type === 'text' ? { ...p, text: p.text.replace(/^\[SISTEMA\]\s*/, '') } : p
      ),
    };
  });

  // Comprime o histórico quando necessário para evitar context overflow.
  // V2: usa cache do DB — LLM só chamado quando o cache está ausente ou vencido.
  const summarizerModel = getModelForTask('tldr');
  const {
    messages: compressedMessages,
    compressed,
    originalCount,
    newSummary,
    newSummaryMsgCount,
  } = await compressHistoryIfNeeded(
    messagesForModel,
    summarizerModel,
    cachedSummary,
    cachedSummaryCount
  );

  if (compressed) {
    // uncoveredSinceCache = (originalCount - KEEP_RECENT[14]) - cachedSummaryCount
    const uncovered = originalCount - 14 - cachedSummaryCount;
    const cacheStatus = !cachedSummary
      ? 'COLD'
      : newSummary
        ? `MISS (${uncovered} novas msgs fora da janela)`
        : `HIT (${uncovered} msgs acumuladas, abaixo do threshold)`;
    logger.warn(
      `[Chat] 📦 histórico comprimido: ${originalCount} → ${compressedMessages.length} msgs | cache=${cacheStatus}`
    );
    // Salva o novo resumo no DB de forma assíncrona (fire-and-forget)
    if (newSummary && chatId) {
      db.update(chatSessions)
        .set({ conversationSummary: newSummary, conversationSummaryCount: newSummaryMsgCount })
        .where(eq(chatSessions.id, chatId))
        .catch((err: unknown) => logger.error('[Chat] ❌ erro ao salvar summary cache:', err));
    }
  }

  // Converte UIMessage[] (formato do useChat@3) para ModelMessage[] (formato do streamText ai@6)
  const modelMessages = await convertToModelMessages(compressedMessages);

  const lastUserText = modifiedMessages.at(-1)?.parts?.find((p: any) => p.type === 'text');
  logger.debug('[Chat] last user msg  :', (lastUserText as any)?.text?.slice?.(0, 120));

  // Contadores de chunk para diagnóstico — reiniciados a cada request
  const chunkStats: Record<string, number> = {};

  const result = streamText({
    model: orchestratorModel,
    messages: modelMessages,
    stopWhen: stepCountIs(8),
    // NOTA: thinkingConfig removido intencionalmente.
    // Bug confirmado em @ai-sdk/google@1.2.22 + gemini-2.5-flash:
    // quando thinkingBudget > 0, o SDK não consegue extrair tool calls da resposta
    // (finishReason='tool-calls' mas toolCalls=[] e chunk stats={}).
    // O modelo funciona corretamente para tool calling sem thinkingConfig explícito.
    onChunk: ({ chunk }) => {
      // Acumula estatísticas por tipo (exibidas no onStepFinish)
      chunkStats[chunk.type] = (chunkStats[chunk.type] ?? 0) + 1;
      // Loga apenas eventos relevantes — text-delta é omitido (muito verboso com smoothStream)
      if (chunk.type === 'tool-call') {
        logger.chunk('tool-call', { toolName: (chunk as any).toolName });
      } else if (chunk.type === 'tool-result') {
        logger.chunk('tool-result', { toolName: (chunk as any).toolName });
      }
    },
    onStepFinish: (step) => {
      logger.info('[Chat] ── step finished ────────────────────');
      logger.info('[Chat] tool calls  :', step.toolCalls?.length ?? 0);
      logger.info('[Chat] text length :', step.text?.length ?? 0);
      logger.info('[Chat] finish reason:', step.finishReason);
      logger.debug('[Chat] chunk stats :', chunkStats);
      logger.debug('[Chat] usage       :', step.usage);
      if (step.toolCalls && step.toolCalls.length > 0) {
        step.toolCalls.forEach((tc: any) => {
          logger.info(
            '[Chat] → tool call :',
            tc.toolName,
            '| args keys:',
            // ai@5: tc.input (era tc.args em ai@4)
            Object.keys((tc as any).input ?? (tc as any).args ?? {})
          );
        });
      }
      step.toolResults?.forEach((tr: any) => {
        // ai@5: tr.output (era tr.result em ai@4)
        const trOutput = (tr as any).output ?? (tr as any).result;
        logger.info(
          `[Chat] ← tool result: ${tr.toolName} | success=${(trOutput as any)?.success} | articles=${(trOutput as any)?.total_articles ?? 'n/a'}`
        );
        // Trunca campos grandes (ex: review ~10k chars) para não poluir o terminal.
        logger.debug(
          `[Chat] ← tool result body:`,
          (() => {
            if (!trOutput || typeof trOutput !== 'object') return trOutput;
            const truncated: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(trOutput as Record<string, unknown>)) {
              truncated[k] =
                typeof v === 'string' && v.length > 200
                  ? `${v.slice(0, 200)}… [+${v.length - 200} chars]`
                  : v;
            }
            return truncated;
          })()
        );
      });
      if (step.text?.length > 0) {
        logger.debug('[Chat] step text preview:', step.text.slice(0, 200));
      }
    },
    system: systemPromptOverride + fallbackInstruction,
    // P-07: Tool handlers extraídos para server/tools/ (SRP).
    // Cada builder recebe o contexto da request (userId/chatId) via closure.
    tools: {
      propose_search_sol_database: buildProposeSearchSolDatabaseTool({ sessionUserId, chatId }),
      propose_search_global_database: buildProposeSearchGlobalDatabaseTool({
        sessionUserId,
        chatId,
      }),
      add_article_by_doi: buildAddArticleByDoiTool({ sessionUserId, chatId }),
      generate_systematic_review: buildGenerateSystematicReviewTool({
        sessionUserId,
        chatId,
        queryId,
      }),
    } as any,
    onFinish: async (event) => {
      const e = event as any;
      logger.info('[Chat] ── onFinish ─────────────────────────');
      logger.info('[Chat] steps          :', e.steps?.length ?? 0);
      logger.info('[Chat] response.msgs  :', e.response?.messages?.length ?? 0);
      logger.info('[Chat] finishReason   :', e.finishReason);
      logger.debug('[Chat] usage total    :', e.usage);
      // Log por step para diagnóstico
      if (logger.isDebug && e.steps?.length > 0) {
        e.steps.forEach((s: any, i: number) => {
          logger.debug(
            `[Chat] step[${i}] text=${s.text?.length ?? 0}chars toolCalls=${s.toolCalls?.length ?? 0} reason=${s.finishReason}`
          );
        });
      }

      // Primary: use response.messages from SDK (most canonical form)
      const fromResponse: Record<string, any>[] = e.response?.messages ?? [];

      // Fallback: reconstruct from event.steps when response.messages is empty
      const builtFromSteps: Record<string, any>[] = [];
      if (fromResponse.length === 0 && e.steps?.length > 0) {
        for (const step of e.steps as any[]) {
          if (step.text) {
            builtFromSteps.push({ role: 'assistant', content: step.text });
          }
          if (step.toolCalls?.length > 0) {
            for (const tc of step.toolCalls as any[]) {
              builtFromSteps.push({
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    // ai@5: input (era args em ai@4)
                    input: (tc as any).input ?? tc.args,
                  },
                ],
              });
            }
          }
          if (step.toolResults?.length > 0) {
            for (const tr of step.toolResults as any[]) {
              builtFromSteps.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: tr.toolCallId,
                    toolName: tr.toolName,
                    // ai@5: output (era result em ai@4)
                    output: (tr as any).output ?? tr.result,
                  },
                ],
              });
            }
          }
        }
      }

      const responseMsgs: any[] = fromResponse.length > 0 ? fromResponse : builtFromSteps;
      logger.info(
        '[Chat] responseMsgs   :',
        responseMsgs.length,
        `(fonte: ${fromResponse.length > 0 ? 'response.messages' : 'builtFromSteps'})`
      );

      // Save summary if present
      const tldrGeral = responseMsgs.find(
        (m) => typeof m.content === 'string' && m.content.includes('📚 TL;DR Geral')
      );

      // Find the active queryId — tool results são a fonte autoritativa (queryId do cliente
      // pode ser igual ao chatId quando o usuário está em /workspace/chat/[chatId]).
      let activeQueryId: string | null = null;

      // 1) Sempre varre os tool results primeiro (mais confiável)
      if (e.steps?.length > 0) {
        for (const step of e.steps as any[]) {
          const found = (step.toolResults ?? []).find(
            (t: any) =>
              (t.toolName === 'propose_search_sol_database' ||
                t.toolName === 'propose_search_global_database') &&
              // ai@5: output (era result em ai@4)
              ((t as any).output ?? t.result)?.query_id
          );
          if (found) {
            activeQueryId = ((found as any).output ?? (found as any).result)?.query_id;
            break;
          }
        }
      }

      // 2) Fallback: queryId do cliente, mas SÓ se for diferente do chatId
      //    (queryId = chatId indica que o frontend não tinha um query ativo — ignora)
      if (!activeQueryId && queryId && queryId !== chatId) {
        activeQueryId = queryId;
      }

      // Fase 1 (P-01): salva com chatId como chave prim\u00e1ria de sess\u00e3o.
      // activeQueryId \u00e9 passado como metadado opcional — n\u00e3o bloqueia o salvamento.
      const saveAnchor = chatId ?? activeQueryId; // retrocompat: se n\u00e3o h\u00e1 chatId, usa queryId
      if (saveAnchor) {
        try {
          // Save ONLY the last user message + new response messages.
          // The rest of the history is already persisted from previous turns.
          const lastUserMsg = messages[messages.length - 1];
          const msgsToSave = lastUserMsg ? [lastUserMsg, ...responseMsgs] : responseMsgs;

          if (chatId) {
            await saveChatMessages(chatId, msgsToSave, activeQueryId ?? undefined);
            logger.info(
              `[Chat] 💾 salvo ${msgsToSave.length} msgs → chat: ${chatId} | query: ${activeQueryId ?? 'N/A'}`
            );
          } else {
            // Fallback retrocompat\u00edvel (sem chatId — comportamento anterior)
            logger.warn('[Chat] ⚠️ chatId ausente — fallback para activeQueryId');
          }

          if (tldrGeral && activeQueryId) {
            await db
              .update(searchQueries)
              .set({ summary: tldrGeral.content })
              .where(eq(searchQueries.id, activeQueryId));
            logger.info(`[Chat] 📚 summary salvo → query: ${activeQueryId}`);
          }
          // P-17: gera título human-readable na primeira mensagem da sessão.
          // Condição: apenas quando é a primeira troca (messages.length === 1 = só o user msg).
          // Fire-and-forget — não bloqueia o response.
          if (chatId && messages.length === 1) {
            const firstUserText =
              messages[0]?.parts?.find((p: any) => p.type === 'text')?.text ??
              messages[0]?.content ??
              '';
            if (firstUserText) {
              getModelForTask('tldr'); // warm up (já instanciado)
              generateText({
                model: getModelForTask('tldr'),
                prompt: `Gere um título CURTO (máximo 6 palavras) em Português do Brasil para uma sessão de pesquisa acadêmica iniciada com esta mensagem do usuário. Retorne APENAS o título, sem aspas, sem pontuação final.\n\nMensagem: ${String(firstUserText).slice(0, 300)}`,
              })
                .then(({ text: generatedTitle }) => {
                  const title = generatedTitle.trim().slice(0, 80);
                  return db.update(chatSessions).set({ title }).where(eq(chatSessions.id, chatId));
                })
                .then(() => logger.info(`[Chat] 🏷️ título gerado → chat: ${chatId}`))
                .catch((err: unknown) => logger.error('[Chat] ❌ erro ao gerar título:', err));
            }
          }
        } catch (error) {
          logger.error('[Chat] falha ao salvar hist\u00f3rico:', error);
        }
      } else {
        logger.warn('[Chat] ⚠️ chatId e activeQueryId ausentes — msgs NÃO salvas.');
        if (logger.isDebug) {
          // Diagnóstico: mostra o que o modelo devolveu para facilitar triagem
          logger.debug(
            '[Chat] response.messages raw:',
            JSON.stringify(e.response?.messages ?? []).slice(0, 500)
          );
          logger.debug('[Chat] steps raw:', JSON.stringify(e.steps ?? []).slice(0, 500));
        }
      }
    },
  });

  logger.info('[Chat] stream finalizado — enviando ao cliente');
  return result.toUIMessageStreamResponse();
}

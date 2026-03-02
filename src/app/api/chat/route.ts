import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import { auth } from '@/auth';
import { getModelForTask, getModelIdForTask } from '@/lib/ai-provider';
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
export const maxDuration = 60;

export async function POST(req: Request) {
  // P-02: obter userId da sessão para vincular searchQueries ao utilizador
  const session = await auth();
  const sessionUserId = session?.user?.id ?? null;

  const { messages, queryId, chatId } = await req.json();

  // Fase 1 (P-01): Garante que a chat_session existe no DB para o chatId recebido.
  // O cliente gera o UUID localmente (otimista) e a primeira request cria o registro.
  if (chatId) {
    await db
      .insert(chatSessions)
      .values({ id: chatId, userId: sessionUserId })
      .onConflictDoNothing({ target: chatSessions.id });
  }

  const modifiedMessages = [...messages];
  const lastMessage = modifiedMessages[modifiedMessages.length - 1];

  const systemPromptOverride = `Você é o SOL Assistant, um pesquisador sênior em Ciência da Computação especializado em revisão sistemática de literatura acadêmica.

**FLUXO DE BUSCA — quando o usuário PEDIR explicitamente uma pesquisa:**
1. Chame IMEDIATAMENTE \`propose_search_sol_database\` (ou \`propose_search_global_database\` para OpenAlex). Não descreva o que vai fazer — apenas chame a ferramenta.
2. Após retorno, escreva APENAS uma frase curta confirmando (ex.: "Estratégia montada. Revise e execute no card acima."). PARE imediatamente.
3. Não repita uma proposta se já houver uma no histórico — aguarde o usuário clicar em Executar.
- NUNCA liste strings de busca no corpo do texto. Elas só existem dentro das ferramentas.

**FLUXO DE CONVERSA — quando o usuário fizer uma PERGUNTA sobre os artigos ou a revisão:**
- Responda com base nos artigos e na revisão já gerados nesta sessão.
- Se os dados disponíveis forem insuficientes para responder à pergunta com precisão, diga isso claramente em uma frase (ex.: "Os artigos encontrados nesta sessão não cobrem esse aspecto específico.") e PERGUNTE se o usuário deseja ampliar a pesquisa.
- NÃO chame ferramentas de busca automaticamente em resposta a perguntas — só chame se o usuário PEDIR explicitamente mais artigos ou uma nova busca.

**REGRAS GERAIS:**
- Responda OBRIGATORIAMENTE em Português do Brasil.
- Seja conciso — frases curtas, sem preâmbulos desnecessários.`;

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
Quando o usuário pedir uma nova busca ou quiser AMPLIAR o acervo, chame \`propose_search_sol_database\` ou \`propose_search_global_database\`. Isso INCREMENTA o acervo existente — não substitui.

**ARTIGOS DISPONÍVEIS NESTA SESSÃO (resumo para contexto):**
${bibliographySummary || 'Nenhum artigo listado.'}`;

      // Aviso adicional se poucos resultados
      if (doneArticles.length <= 5) {
        fallbackInstruction += `\n\n**AVISO:** Poucos artigos encontrados na base SOL (<= 5). Se adequado, sugira ao usuário ampliar a busca para a base global (**OpenAlex**) chamando \`propose_search_global_database\`.`;
      }
    }
  }

  const modelId = getModelIdForTask('orchestrator');
  const orchestratorModel = getModelForTask('orchestrator');

  logger.info('[Chat] ── request ──────────────────────────');
  logger.info('[Chat] messages count :', modifiedMessages.length);
  logger.info('[Chat] activeQueryId  :', queryId ?? 'none');
  logger.info('[Chat] modelo         :', modelId);
  logger.info('[Chat] LOG_MODE       :', process.env.LOG_MODE ?? '(não definido → development)');

  // P-15: Filtra mensagens [SISTEMA] antes de converter para ModelMessages.
  // Essas mensagens são disparadas internamente pelo cliente para acionar ferramentas
  // (ex: generate_systematic_review) e NÃO devem inflar o contexto do LLM.
  // São convertidas para o role 'user' pelo SDK, mas o modelo não precisa delas após o passo.
  const messagesWithoutSistema = modifiedMessages.filter((m: any) => {
    const textPart = m.parts?.find((p: any) => p.type === 'text');
    return !(m.role === 'user' && textPart?.text?.startsWith('[SISTEMA]'));
  });

  // Converte UIMessage[] (formato do useChat@3) para ModelMessage[] (formato do streamText ai@6)
  const modelMessages = await convertToModelMessages(messagesWithoutSistema);

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
      // Incrementa contador
      chunkStats[chunk.type] = (chunkStats[chunk.type] ?? 0) + 1;
      // Loga apenas em dev — não polui produção
      if (chunk.type === 'text-delta') {
        // ai@5: text chunk usa chunk.text (não chunk.textDelta)
        logger.chunk('text-delta', `"${(chunk as any).text?.slice(0, 60)}"`);
      } else if (chunk.type === 'tool-input-delta') {
        logger.chunk('tool-input-delta', { toolName: (chunk as any).toolName });
      } else if (chunk.type === 'tool-call') {
        logger.chunk('tool-call', { toolName: (chunk as any).toolName });
      } else if (chunk.type === 'tool-result') {
        logger.chunk('tool-result', { toolName: (chunk as any).toolName });
      } else {
        logger.chunk(chunk.type);
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
        logger.info(`[Chat] ← tool result: ${tr.toolName} | success=${(trOutput as any)?.success}`);
        logger.debug(`[Chat] ← tool result body:`, trOutput);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fromResponse: Record<string, any>[] = e.response?.messages ?? [];

      // Fallback: reconstruct from event.steps when response.messages is empty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builtFromSteps: Record<string, any>[] = [];
      if (fromResponse.length === 0 && e.steps?.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const step of e.steps as any[]) {
          if (step.text) {
            builtFromSteps.push({ role: 'assistant', content: step.text });
          }
          if (step.toolCalls?.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // Find the active queryId
      let activeQueryId = queryId;
      if (!activeQueryId && e.steps?.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const step of e.steps as any[]) {
          const found = (step.toolResults ?? []).find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

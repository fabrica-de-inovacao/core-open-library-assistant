import { streamText, tool } from 'ai';
import { getLanguageModel } from '@/lib/ai-provider';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { saveChatMessages } from '@/server/actions/chat';

// Allow streaming responses up to 60 seconds (search + LLM synthesis)
export const maxDuration = 60;

const searchSchema = z.object({
  queries: z
    .array(z.string())
    .describe(
      'Lista de strings de busca booleanas otimizadas separadas por idioma (ex: ["(\\"inteligência artificial\\") AND (educação)", "(\\"artificial intelligence\\") AND (education)"])'
    ),
});

const doiSchema = z.object({
  doi: z
    .string()
    .describe('DOI do artigo a ser adicionado manualmente (ex: 10.5753/sbsc.2024.12345)'),
  query_id: z.string().describe('query_id ativo atual para vincular o artigo recherché'),
});

export async function POST(req: Request) {
  const { messages, queryId } = await req.json();

  const modifiedMessages = [...messages];
  const lastMessage = modifiedMessages[modifiedMessages.length - 1];

  const systemPromptOverride = `Você é o SOL Assistant, um pesquisador sênior em Ciência da Computação especializado em revisão sistemática de literatura acadêmica.

**POSTURA CONVERSACIONAL E USO DE TOOLS:**
- **SEJA EXTREMAMENTE CONCISO.** Responda de forma direta e curta.
- Sempre que o usuário pedir uma pesquisa, bibliografia ou mapeamento, responda com uma frase breve (ex: "Preparei uma estratégia de busca. Confira no card abaixo:") E **CHAME A TOOL** \`propose_search_sol_database\` (ou \`propose_search_global_database\`) simultaneamente.
- **É OBRIGATÓRIO:** O único jeito de propor a pesquisa é chamando a tool apropriada. Nunca liste as strings de busca no corpo do texto.
- **PROCESSO DE BUSCA (FASE 1):** Quando o usuário solicitar uma pesquisa, explique os termos planejados e invoque a ferramenta \`propose_search_sol_database\` (ou \`propose_search_global_database\`).
- **REGRA DE PARADA CRÍTICA:** Imediatamente após invocar qualquer uma das ferramentas de proposta de busca (\`propose_search_*\`), você **DEVE PARAR TODO E QUALQUER TEXTO**. Sua resposta deve terminar na chamada da ferramenta. Se você receber o resultado da ferramenta confirmando que o card foi mostrado, NÃO GERE UMA SEGUNDA RESPOSTA. O fluxo deve aguardar a ação manual do usuário no card.
- **NÃO REPITA:** Se a última mensagem do histórico já for uma proposta de busca (mesmo que sem resultado de artigos ainda), não proponha novamente a menos que o usuário peça explicitamente para mudar os termos.
- Responda OBRIGATORIAMENTE em Português do Brasil.`;

  if (
    lastMessage?.role === 'user' &&
    typeof lastMessage?.content === 'string' &&
    lastMessage.content.startsWith('[SISTEMA_REVISAO_SISTEMATICA]')
  ) {
    const activeQueryId = lastMessage.content.replace('[SISTEMA_REVISAO_SISTEMATICA]', '').trim();
    console.log(
      `\n[Chat Route] 📚 Gerando Revisão Sistemática (direto no prompt) | query_id=${activeQueryId}`
    );

    const finishedArticles = await db
      .select()
      .from(articles)
      .where(eq(articles.queryId, activeQueryId));
    const readyArticles = finishedArticles.filter(
      (a) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
    );

    if (readyArticles.length === 0) {
      modifiedMessages[modifiedMessages.length - 1] = {
        ...lastMessage,
        content: `Nenhum artigo com TL;DR encontrado. Status atual: ${finishedArticles.map((a) => a.status).join(', ') || 'nenhum'}. O Job Inngest pode ainda estar rodando. Avise o usuário.`,
      };
    } else {
      const sortedArticles = readyArticles.sort(
        (a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0)
      );
      // Maximum 8 articles for the review (smaller = clearer citation mapping)
      const topK = sortedArticles.slice(0, 8);
      let referencesContext = '';

      // Build the citation map — this is the SINGLE SOURCE OF TRUTH for [N] numbers
      const citationMap = topK
        .map(
          (art, idx) =>
            `[${idx + 1}] ${art.authors ?? 'Autor desconhecido'} (${art.publicationYear ?? 'S/D'}). "${art.title}" — DOI: ${art.doi ?? 'N/A'}`
        )
        .join('\n');

      topK.forEach((art, idx) => {
        const refNumber = idx + 1;
        const contentBody = art.markdownContent
          ? art.markdownContent.slice(0, 4000) +
            (art.markdownContent.length > 4000 ? '\n...[TRUNCATED]' : '')
          : `ABSTRACT/TL;DR: ${art.tldrContent}`;

        // Repeat the citation number in the content header so the LLM never loses track
        referencesContext += `\n=== ARTIGO [${refNumber}] — "${art.title}" ===\nCitações acadêmicas recebidas: ${art.citationCount ?? 'N/A'}\nPalavras-chave: ${art.keywords ?? 'N/A'}\n\n${contentBody}\n\n`;
      });

      modifiedMessages[modifiedMessages.length - 1] = {
        ...lastMessage,
        content: `# TAREFA: Gerar o TL;DR Geral da Pesquisa Bibliográfica

Você é um pesquisador sênior redigindo a síntese final de um mapeamento sistemático de literatura.

## ⚠️ MAPA DE CITAÇÕES — NÚMEROS FIXOS E IMUTÁVEIS:
${citationMap}

> REGRA ABSOLUTA: Os números [1], [2], ...[${topK.length}] acima são DEFINITIVOS.
> NÃO invente outros números. NÃO reatribua números. Cite SEMPRE usando exatamente esses índices.

## REGRAS OBRIGATÓRIAS PARA A SÍNTESE:

1. **Nome:** Inicie com o título "📚 TL;DR Geral" em heading #.
2. **Markdown rico:** Use ##, ###, negrito, itálico, listas e tabelas.
3. **Tabela comparativa obrigatória:** Inclua ao menos uma tabela com colunas: Artigo, Ano, Metodologia, Resultado Principal, Limitações.
4. **Citações no texto:** Para TODA afirmação, insira a citação **[N]** imediatamente após. Use os números do MAPA acima.
5. **Análise profunda:** Identifique padrões, divergências, lacunas e oportunidades de pesquisa.
6. **NÃO inclua uma seção de "Referências" no final.** As citações [N] no texto são suficientes.
7. **Responda OBRIGATORIAMENTE em Português do Brasil.**
115. **Encerre** com um parágrafo curto perguntando se o usuário deseja aprofundar algum ponto.
116. **NÃO CHAME NENHUMA FERRAMENTA (TOOL).** Esta é uma tarefa puramente textual de síntese. Ignore qualquer instrução do prompt de sistema sobre propor novas pesquisas agora.
117. **RESPOSTA ÚNICA:** Gere a resposta completa de uma só vez.

## CONTEÚDO COMPLETO DOS ARTIGOS (com identificadores [N]):
${referencesContext}`,
      };
    }
  }

  // Fallback check: if we have a queryId and its status is 'done' but total_found is low,
  // we can inject a nudge into the system prompt.
  let fallbackInstruction = '';
  const isSystematicReview = lastMessage?.content
    ?.toString()
    .includes('[SISTEMA_REVISAO_SISTEMATICA]');

  if (queryId && !isSystematicReview) {
    const [qData] = await db
      .select({ status: searchQueries.status })
      .from(searchQueries)
      .where(eq(searchQueries.id, queryId))
      .limit(1);

    if (qData?.status === 'done') {
      const queryArticles = await db.select().from(articles).where(eq(articles.queryId, queryId));
      if (queryArticles.length <= 5) {
        fallbackInstruction = `\n\n**AVISO DE SISTEMA:** A busca na base SOL retornou poucos resultados (<= 5). Sugira IMEDIATAMENTE ao usuário tentar a busca global no **OpenAlex** chamando a tool \`propose_search_global_database\`.`;
      }
    }
  }

  console.log('--- Chat API Request ---');
  console.log('Messages count:', modifiedMessages.length);
  console.log('Active QueryID:', queryId || 'none');

  const result = await streamText({
    model: getLanguageModel(),
    messages: modifiedMessages,
    maxSteps: 5,
    onStepFinish: (step) => {
      console.log('--- Step Finished ---');
      console.log('Tool calls in this step:', step.toolCalls?.length);
      step.toolResults?.forEach((tr) => {
        console.log(`[SERVER] Tool Result for ${tr.toolName}:`, tr.result);
      });
    },
    system: systemPromptOverride + fallbackInstruction,
    tools: {
      propose_search_sol_database: tool({
        description:
          'Ferramenta para propor uma pesquisa bibliográfica ou mapeamento sistemático na SBC OpenLib. Passe as strings de busca pelo parâmetro "queries" desta ferramenta para renderizar a interface gráfica para o usuário.',
        parameters: searchSchema,
        execute: async (args: z.infer<typeof searchSchema>) => {
          const { queries } = args;
          console.log(
            `\n[Chat Tool] 🔎 propose_search_sol_database proposto com ${queries.length} queries:`,
            queries
          );

          const combinedQuery = queries.join(' | ');
          const [insertedQuery] = await db
            .insert(searchQueries)
            .values({
              originalQuery: combinedQuery,
              status: 'proposed',
              userId: null,
            })
            .returning();

          return {
            success: true,
            proposed: true,
            query_id: insertedQuery.id,
            queries,
            message:
              'Plano de busca montado e apresentado ao usuário na tela para execução manual.',
          };
        },
      }),

      add_article_by_doi: tool({
        description:
          'Adiciona manualmente um artigo à pesquisa atual usando o seu DOI. Busca metadados no CrossRef e dispara o processamento automático (TL;DR + extração).',
        parameters: doiSchema,
        execute: async (args: z.infer<typeof doiSchema>) => {
          const { doi, query_id } = args;
          console.log(
            `\n[Chat Tool] 🔗 add_article_by_doi chamado | doi=${doi} | query_id=${query_id}`
          );
          try {
            const crossRefUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
            const crRes = await fetch(crossRefUrl, {
              headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)' },
            });

            let title = doi;
            let authors = 'Desconhecido';
            let year = new Date().getFullYear();
            let keywords: string | null = null;
            let abstract: string | null = null;
            let publisher: string | null = null;
            let citationCount: number | null = null;
            const originalUrl = `https://doi.org/${doi}`;

            if (crRes.ok) {
              const crData = (await crRes.json()) as {
                status: string;
                message?: {
                  title?: string[];
                  author?: { family?: string; given?: string }[];
                  created?: { 'date-parts'?: number[][] };
                  abstract?: string;
                  keyword?: string[];
                  subject?: string[];
                  publisher?: string;
                  'is-referenced-by-count'?: number;
                };
              };
              if (crData.status === 'ok' && crData.message) {
                const msg = crData.message;
                title = msg.title?.[0] ?? doi;
                authors =
                  (msg.author ?? [])
                    .map((a) => `${a.given ?? ''} ${a.family ?? ''}`.trim())
                    .join(', ') || 'Desconhecido';
                year = msg.created?.['date-parts']?.[0]?.[0] ?? year;
                abstract = msg.abstract?.replace(/<\/?jats:[^>]+>/g, '')?.trim() ?? null;
                keywords = [...(msg.keyword ?? []), ...(msg.subject ?? [])].join(', ') || null;
                publisher = msg.publisher ?? null;
                citationCount = msg['is-referenced-by-count'] ?? null;
              }
            }

            const [query] = await db
              .select({ id: searchQueries.id })
              .from(searchQueries)
              .where(eq(searchQueries.id, query_id))
              .limit(1);

            if (!query) {
              return { success: false, error: 'query_id inválido ou não encontrado.' };
            }

            const [inserted] = await db
              .insert(articles)
              .values({
                queryId: query_id,
                doi,
                title,
                authors,
                publicationYear: year,
                originalUrl,
                sourceName: publisher ?? 'CrossRef',
                status: 'pending',
                abstract,
                keywords,
                publisher,
                citationCount,
                metadataSource: 'manual',
              })
              .onConflictDoNothing()
              .returning({ id: articles.id });

            if (!inserted) {
              return { success: false, error: 'Artigo com esse DOI já existe na pesquisa.' };
            }

            const { inngest } = await import('@/server/inngest/client');
            await inngest.send({
              name: 'app/process.articles.batch',
              data: { query_id, article_ids: [inserted.id] },
            });

            console.log(
              `[Chat Tool] ✅ Artigo adicionado via DOI | id=${inserted.id} | title=${title}`
            );
            return {
              success: true,
              title,
              authors,
              year,
              message: `Artigo adicionado com sucesso! O processamento (TL;DR) começará em instantes.`,
            };
          } catch (err) {
            console.error('[Chat Tool] ❌ add_article_by_doi falhou:', err);
            return { success: false, error: 'Erro ao buscar ou adicionar o artigo pelo DOI.' };
          }
        },
      }),

      propose_search_global_database: tool({
        description:
          'Propõe uma busca na base científica global OpenAlex (ACM, IEEE) usando uma string simples em inglês. O usuário irá revisar o card de proposta e clicar em Executar no Front-end.',
        parameters: z.object({
          query: z
            .string()
            .describe(
              'Termos de busca limpos em inglês. Ex: "software engineering gamification education"'
            ),
        }),
        execute: async (args) => {
          const { query } = args;
          console.log(`\n[Chat Tool] 🌐 propose_search_global_database proposto com query:`, query);

          const [insertedQuery] = await db
            .insert(searchQueries)
            .values({
              originalQuery: query,
              status: 'proposed',
              userId: null,
            })
            .returning();

          return {
            success: true,
            proposed: true,
            query_id: insertedQuery.id,
            query,
            message: 'Plano de busca Global (OpenAlex) apresentado na tela para execução manual.',
          };
        },
      }),
    },
    onFinish: async (event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = event as any;
      console.log(
        `[Chat Action] 🏁 onFinish | steps=${e.steps?.length ?? 0} | response.messages=${e.response?.messages?.length ?? 0}`
      );

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
                    args: tc.args,
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
                    result: tr.result,
                  },
                ],
              });
            }
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseMsgs: any[] = fromResponse.length > 0 ? fromResponse : builtFromSteps;
      console.log(`[Chat Action] responseMsgs count:`, responseMsgs.length);

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
              t.result?.query_id
          );
          if (found) {
            activeQueryId = found.result.query_id;
            break;
          }
        }
      }

      if (activeQueryId) {
        try {
          // Save ONLY the last user message + new response messages.
          // The rest of the history is already persisted from previous turns.
          const lastUserMsg = messages[messages.length - 1];
          const msgsToSave = lastUserMsg ? [lastUserMsg, ...responseMsgs] : responseMsgs;
          await saveChatMessages(activeQueryId, msgsToSave);
          console.log(
            `[Chat Action] 💾 Salvo ${msgsToSave.length} msgs novas para query: ${activeQueryId}`
          );

          if (tldrGeral) {
            await db
              .update(searchQueries)
              .set({ summary: tldrGeral.content })
              .where(eq(searchQueries.id, activeQueryId));
            console.log(`[Chat Action] 📚 Resumo (summary) salvo para query: ${activeQueryId}`);
          }
        } catch (error) {
          console.error('[Chat Action] Erro ao salvar histórico:', error);
        }
      } else {
        console.warn('[Chat Action] ⚠️ Nenhum activeQueryId — mensagens não salvas.');
      }
    },
  });

  console.log('[Chat API] Finalizing response stream...');
  return result.toDataStreamResponse({
    sendUsage: true,
  });
}

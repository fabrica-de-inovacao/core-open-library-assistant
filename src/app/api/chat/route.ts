import { streamText, tool } from 'ai';
import { getLanguageModel } from '@/lib/ai-provider';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles } from '@/server/db/schema';
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

const reviewSchema = z.object({
  query_id: z.string().describe('O UID da pesquisa que rastreia os artigos a ler.'),
  max_articles: z
    .number()
    .max(15)
    .default(10)
    .describe('Número máximo de artigos (Reranking top K) a injetar no contexto da revisão.'),
});

export async function POST(req: Request) {
  const { messages, queryId } = await req.json();

  // The Orchestrator Agent (Planner)
  // maxSteps > 1 is REQUIRED: without it, streamText stops after the tool call
  // and cannot stream the final LLM response back to the user
  const result = await streamText({
    model: getLanguageModel(),
    messages,
    maxSteps: 5,
    system: `Você é o SOL Assistant, um pesquisador sênior especializado em revisão sistemática de literatura da SBC OpenLib.

ESTRATÉGIA DE BUSCA MULTILÍNGUE (ANTIFALHAS 504):
A SBC OpenLib (servidor) sofre "Gateway Timeout" (erro 504) se receber uma única string booleana com os três idiomas (acentuados) todos juntos.
Para resolver isso, você DEVE sempre dividir os termos de busca em MÚLTIPLAS strings compactas separadas por idioma (EN, PT e ES).

REGRAS RÍGIDAS DE PALAVRAS-CHAVE E TRADUÇÃO:
- NOMES PRÓPRIOS, SIGLAS E PROJETOS NÃO SE TRADUZEM: Se o usuário citar "Mermãs Digitais", "Scrum", "IoT", ou "SBC", mantenha o termo original exato protegido por aspas em TODAS as queries de todos os idiomas. Ex: (\\"Mermãs Digitais\\") AND (computação OR computing).
- EXTRAÇÃO SEMÂNTICA, NÃO LITERAL: Se o usuário fizer uma pergunta ampla (ex: "traga o principal desafio da computação em IA"), extraia OS CONCEITOS ACADÊMICOS (ex: "grandes desafios" OR "grand challenges", "computação", "inteligência artificial"). Não limite a busca a termos literais simplistas que ignoram o domínio. Use sinônimos conhecidos da literatura.
- NUNCA use frases inteiras, verbos, ou termos compostos não-acadêmicos (ex: NUNCA use "trabalhos que avaliam trabalhos" ou "como ensinar").
- Use APENAS termos raízes acadêmicos exatos e concisos (ex: "revisão sistemática", "meta-análise", survey, "ensino fundamental").
- Mantenha cada string com no MÁXIMO 4 blocos AND.

Exemplo de divisão correta da busca pelo tema "jogos digitais no ensino médio":
Em vez de enviar uma query gigante combinando PT, EN e ES, você enviará UM ARRAY DE STRINGS (queries) na chamada da tool search_sol_database:
[
  "(\\"jogo digital\\" OR \\"jogo eletrônico\\" OR videogame) AND (\\"ensino médio\\" OR \\"ensino secundário\\")",
  "(\\"digital game\\" OR \\"video game\\" OR videogame) AND (\\"high school\\" OR \\"secondary education\\")",
  "(\\"juego digital\\" OR videojuego) AND (\\"educación secundaria\\" OR bachillerato)"
]

SEU FLUXO DE TRABALHO:

**FASE 1 — PLANEJAMENTO E EXECUÇÃO (em uma única resposta)**
Quando o usuário descrever um tema:
a) Identifique os conceitos-chave de maneira extremamente concisa e acadêmica.
b) Formule até 3 strings booleanas isoladas (divididas por idioma) que cubram o contexto perfeitamente.
c) Exiba ao usuário concisamente:
   "🔍 A base será consultada dividindo os temas para PT, EN e ES a fim de garantir a extração de dados sem Timeouts da SBC OpenLib..."
d) Na MESMA RESPOSTA, passe o array de queries diretamente para a tool search_sol_database.
   NÃO PEÇA CONFIRMAÇÃO AUTOMATIZADA. VOCÊ ESTÁ AUTORIZADO A BUSCAR.

**FASE 2 — APÓS A BUSCA (resposta amigável)**
- Se a tool retornar \`total_found=0\` (zero) ou \`success=false\`: Informe de forma amigável, como um assistente ativo, que a busca não encontrou resultados. Analise a intenção original e sugira **na mesma frase ou pergunta** 3 conceitos melhores ou mais abrangentes. Exemplo: *"A busca não retornou artigos, mas podemos tentar focar em conceitos mais abrangentes como [X], [Y] ou [Z] na sua próxima busca. O que acha?"*. PARE sua resposta por aqui.
- Se a tool retornar artigos (> 0): A interface visual assumirá o controle. VOCÊ NÃO DEVE GERAR MENSAGENS DIZENDO QUE O PROCESSAMENTO COMEÇOU. Simplesmente encerre sua resposta silenciosamente.
- NÃO mencione query_id, UUIDs ou detalhes técnicos.

**FASE 3 — REVISÃO SISTEMÁTICA**
Quando receber [SISTEMA], chame IMEDIATAMENTE generate_systematic_review com o query_id informado.

REGRAS ABSOLUTAS:
- NUNCA peça confirmação antes de buscar. Apresente e execute em uma única resposta.
- NUNCA exponha a query booleana expandida completa ao usuário — mostre só os conceitos principais.
- NUNCA exponha query_id, UUIDs ou termos técnicos.
- Responda ao usuário SEMPRE em Português do Brasil.`,

    tools: {
      search_sol_database: tool({
        description:
          'Realiza uma pesquisa na SBC OpenLib usando a string de busca booleana formulada pelo Planner. Retorna metadados dos artigos encontrados e o query_id para rastreamento.',
        parameters: searchSchema,
        execute: async (args: z.infer<typeof searchSchema>) => {
          const { queries } = args;
          console.log(
            `\n[Chat Tool] 🔎 search_sol_database chamado com ${queries.length} queries:`,
            queries
          );
          try {
            const qs = queries.map((q) => `q=${encodeURIComponent(q)}`).join('&');
            const url = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/search?${qs}`;
            console.log(`[Chat Tool] 📡 Chamando api/search com splits sequenciais...`);
            const response = await fetch(url);
            const json = await response.json();
            console.log(
              `[Chat Tool] ✅ search_sol_database resposta: total_found=${json.total_found ?? 'N/A'} | query_id=${json.query_id ?? 'N/A'} | success=${json.success}`
            );
            if (!response.ok) return { success: false, error: 'Falha ao buscar artigos.' };
            return json;
          } catch (error) {
            console.error('[Chat Tool] ❌ Erro ao chamar /api/search:', error);
            return { success: false, error: 'Erro interno ao acessar o motor de busca.' };
          }
        },
      }),

      generate_systematic_review: tool({
        description:
          'Lê até 10 artigos finalizados (status done ou abstract_only com TL;DR) e gera a Revisão Sistemática. Deve ser chamada automaticamente quando o processamento em background concluir.',
        parameters: reviewSchema,
        execute: async (args: z.infer<typeof reviewSchema>) => {
          const { query_id, max_articles } = args;
          console.log(
            `\n[Chat Tool] 📚 generate_systematic_review chamado | query_id=${query_id} | max=${max_articles}`
          );
          // 1. Fetch finished articles for this query from Database
          const finishedArticles = await db
            .select()
            .from(articles)
            .where(eq(articles.queryId, query_id));

          // Accept both fully-processed and abstract-only articles
          // Most articles end up as abstract_only when PDF link fails or redirects
          const readyArticles = finishedArticles.filter(
            (a) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
          );
          console.log(
            `[Chat Tool] 📊 Artigos encontrados: total=${finishedArticles.length} | prontos=${readyArticles.length} | pendentes=${finishedArticles.filter((a) => a.status === 'pending').length} | falhas=${finishedArticles.filter((a) => a.status === 'failed').length}`
          );

          if (readyArticles.length === 0) {
            return {
              success: false,
              message: `Nenhum artigo com TL;DR encontrado. Status atual: ${finishedArticles.map((a) => a.status).join(', ') || 'nenhum'}. O Job Inngest pode ainda estar rodando.`,
            };
          }

          // 2. Reranking (MVP: first K articles with valid TL;DR)
          const topK = readyArticles.slice(0, max_articles);

          // 3. Prepare Context for Analyst Agent Prompt
          let referencesContext = '';
          const mappedReferences: string[] = [];

          topK.forEach((art, idx) => {
            const refNumber = idx + 1;
            mappedReferences.push(
              `[${refNumber}] ${art.authors} (${art.publicationYear}). ${art.title} - ${art.doi || 'Sem DOI'}`
            );
            referencesContext += `--- ARTIGO [${refNumber}] ---\nTítulo: ${art.title}\nTL;DR: ${art.tldrContent}\n\n`;
          });

          // The tool result instructs the LLM (Analyst Agent) to generate the review.
          // The orchestrator's streamText loop (maxSteps) picks this up and generates the streaming response.
          return {
            success: true,
            analyst_instructions:
              'Você é o autor principal de uma Revisão Sistemática de Literatura.\n' +
              'Abaixo está o contexto de literatura extraído e validado.\n\n' +
              'REGRAS ABSOLUTAS:\n' +
              '1. Construa um texto coeso em Markdown dividido por temas encontrados.\n' +
              '2. PARA TODA afirmação, tendência ou conclusão, você DEVE inserir a citação no formato [N] correspondente ao artigo.\n' +
              '3. Se a informação não estiver no contexto fornecido, NÃO a mencione.\n' +
              '4. Responda OBRIGATORIAMENTE em Português do Brasil.\n' +
              '5. AO FINAL da revisão, inclua OBRIGATORIAMENTE esta seção separada por --- :\n' +
              '---\n✅ **Revisão concluída.** Você está satisfeito com os resultados desta revisão bibliográfica, ou deseja ampliar a gama de bibliografia com novos termos de busca?\n\n' +
              `CONTEXTO DOS ARTIGOS:\n${referencesContext}\n\n` +
              `LISTA DE REFERÊNCIAS:\n${mappedReferences.join('\n')}`,
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
      const fromResponse: any[] = e.response?.messages ?? [];

      // Fallback: reconstruct from event.steps when response.messages is empty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builtFromSteps: any[] = [];
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
        console.log(`[Chat Action] Built ${builtFromSteps.length} msgs from event.steps fallback`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseMsgs: any[] = fromResponse.length > 0 ? fromResponse : builtFromSteps;
      console.log(`[Chat Action] responseMsgs count:`, responseMsgs.length);

      // Find the active queryId
      let activeQueryId = queryId;
      if (!activeQueryId && e.steps?.length > 0) {
        for (const step of e.steps as any[]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = (step.toolResults ?? []).find(
            (t: any) => t.toolName === 'search_sol_database' && t.result?.query_id
          );
          if (found) {
            activeQueryId = found.result.query_id;
            break;
          }
        }
      }

      if (activeQueryId) {
        try {
          await saveChatMessages(activeQueryId, [...messages, ...responseMsgs]);
          console.log(
            `[Chat Action] 💾 Salvo ${messages.length + responseMsgs.length} msgs para query: ${activeQueryId}`
          );
        } catch (error) {
          console.error('[Chat Action] Erro ao salvar histórico:', error);
        }
      } else {
        console.warn('[Chat Action] ⚠️ Nenhum activeQueryId — mensagens não salvas.');
      }
    },
  });

  return result.toDataStreamResponse({
    sendUsage: true,
  });
}

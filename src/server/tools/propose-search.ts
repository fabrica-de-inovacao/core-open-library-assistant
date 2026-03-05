/**
 * server/tools/propose-search.ts
 * P-07: Tool execute handlers extraídos de route.ts para manter SRP.
 * Estes módulos são importados pelo route.ts e injetados no streamText.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { desc, eq, ne, and } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';
import { runStrategyAgent } from '@/server/agents/strategy-agent';
import type { SynthesisDepth } from '@/server/agents/synthesis-agent';
import { logger } from '@/lib/logger';

const searchSchema = z.object({
  topic: z
    .string()
    .describe(
      'Tópico central da pesquisa em linguagem natural (ex: "gamificação no ensino superior"). O agente de estratégia gerará as strings de busca automaticamente a partir deste tópico.'
    ),
  queries: z
    .array(z.string())
    .default([])
    .describe(
      'Deixe SEMPRE como array vazio []. As queries são geradas automaticamente pelo agente de estratégia a partir do topic.'
    ),
});

/** Contexto injetado pelo route.ts para acesso a userId/chatId da request */
export interface ToolContext {
  sessionUserId: string | null;
  chatId: string | null;
  /** Fase C (Batch 4 C-2): limita número de queries geradas pelo StrategyAgent */
  synthesisDepth?: SynthesisDepth;
}

export function buildProposeSearchSolDatabaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Ferramenta para propor uma pesquisa bibliográfica na SBC OpenLib. Passe APENAS o `topic` em linguagem natural e `queries: []` — o agente de estratégia gera as strings de busca booleanas automaticamente. NÃO gere queries manualmente.',
    inputSchema: searchSchema,
    execute: async (input: z.infer<typeof searchSchema>) => {
      const { queries: rawQueries, topic } = input;
      logger.info(
        `[Tool] propose_search_sol_database | ${rawQueries.length} queries | topic=${topic ?? 'n/a'}`
      );
      logger.debug('[Tool] queries brutas:', rawQueries);

      try {
        // Fase C (IA-04): busca até 3 estratégias anteriores desta sessão para evitar repetição.
        // Filtra 'proposed' (nunca executadas) e usa expandedQuery (já processada pelo StrategyAgent).
        let previousFailedQueries: string[] = [];
        if (ctx.chatId) {
          try {
            const prevRows = await db
              .select({
                expandedQuery: searchQueries.expandedQuery,
                originalQuery: searchQueries.originalQuery,
              })
              .from(searchQueries)
              .where(
                and(eq(searchQueries.chatId, ctx.chatId), ne(searchQueries.status, 'proposed'))
              )
              .orderBy(desc(searchQueries.createdAt))
              .limit(3);
            // Usa expandedQuery quando disponível (é a string real usada na busca)
            previousFailedQueries = prevRows
              .map((r) => r.expandedQuery ?? r.originalQuery ?? '')
              .filter(Boolean);
            if (previousFailedQueries.length > 0) {
              logger.info(
                `[Tool] Histórico de estratégias anteriores: ${previousFailedQueries.length} queries recuperadas`
              );
            }
          } catch (dbErr) {
            logger.warn('[Tool] Falha ao buscar histórico de queries anteriores:', dbErr);
          }
        }

        // I-04: strategy-agent gera todas as queries a partir do topic
        // Fase C (Batch 4 C-2): cap de queries baseado na profundidade de síntese.
        // brief → 1 query (quick_lookup não precisa de múltiplas estratégias)
        // standard → 2 queries
        // full / undefined → sem cap (StrategyAgent decide)
        const maxQueriesOverride =
          ctx.synthesisDepth === 'brief' ? 1 : ctx.synthesisDepth === 'standard' ? 2 : undefined;

        let finalQueries = rawQueries;
        if (topic) {
          try {
            const strategy = await runStrategyAgent(
              topic,
              rawQueries,
              previousFailedQueries,
              maxQueriesOverride
            );
            finalQueries = strategy.queries;
            logger.info(
              `[Tool] StrategyAgent: geradas ${finalQueries.length} queries para tópico "${topic.slice(0, 60)}"`
            );
            logger.debug('[Tool] queries geradas:', finalQueries);
          } catch (err) {
            logger.warn('[Tool] StrategyAgent falhou:', err);
            // Se não havia queries de fallback, propaga o erro
            if (rawQueries.length === 0) throw err;
          }
        }

        const originalCombined = rawQueries.join(' | ');
        const expandedCombined = finalQueries.join(' | ');
        // O LLM sempre passa rawQueries=[] conforme instruído, logo originalCombined seria "".
        // Usa `topic` como fallback para que o Inngest RelevanceGate tenha contexto real.
        const storedOriginalQuery = originalCombined || topic || '';
        const [insertedQuery] = await db
          .insert(searchQueries)
          .values({
            originalQuery: storedOriginalQuery,
            expandedQuery: expandedCombined !== originalCombined ? expandedCombined : null,
            status: 'proposed',
            userId: ctx.sessionUserId,
            chatId: ctx.chatId,
          })
          .returning();

        if (!insertedQuery) {
          throw new Error('DB insert retornou vazio');
        }

        return {
          success: true,
          proposed: true,
          query_id: insertedQuery.id,
          queries: finalQueries,
          message: 'Plano de busca montado e apresentado ao usuário na tela para execução manual.',
        };
      } catch (err) {
        logger.error('[Tool] propose_search_sol_database falhou:', err);
        return {
          success: false,
          proposed: false,
          queries: rawQueries,
          error: `Erro ao salvar proposta: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}

export function buildProposeSearchGlobalDatabaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Propõe uma busca na base científica global OpenAlex. Regras críticas para a query: ' +
      '(1) Termos genéricos SEMPRE em inglês. ' +
      '(2) Se o usuário citou um nome próprio de projeto, programa, empresa ou equipe (ex: "Mermãs Digitais", "ProInfo"), INCLUA-O ENTRE ASPAS DUPLAS na query — ele pode estar indexado no OpenAlex. O sistema tenta automaticamente uma busca sem o nome próprio caso não encontre resultados. ' +
      '(3) Combine o nome próprio com conceitos gerais em inglês: ex: "\"Mermãs Digitais\" AND (education OR \"digital inclusion\")". ' +
      '(4) Para buscas puramente conceituais (sem nome próprio), use apenas termos em inglês. ' +
      '(5) Prefira queries simples a queries booleanas complexas.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'String de busca para o OpenAlex. Se o input do usuário contém nome próprio de projeto/programa/empresa, inclua-o entre aspas duplas e adicione conceitos em inglês como contexto. Ex. com nome próprio: "\"Mermãs Digitais\" AND (education OR \"digital inclusion\")" ou "\"ProInfo\" AND Brazil AND education". Ex. sem nome próprio: "digital inclusion women education computing"'
        ),
    }),
    execute: async (input) => {
      const { query: rawQuery } = input;

      // Sanitiza delimitadores que o LLM ocasionalmente injeta na query:
      // triple-quotes ('''...'''), backticks, aspas simples/duplas externas.
      // Ex: "'''AI water consumption'''" → "AI water consumption"
      const query = rawQuery
        .replace(/^'{3}|'{3}$/g, '') // remove ''' do início/fim
        .replace(/^"{3}|"{3}$/g, '') // remove """ do início/fim
        .replace(/^`+|`+$/g, '') // remove backticks externos
        .trim();

      if (query !== rawQuery) {
        logger.warn(
          `[Tool] propose_search_global_database | query sanitizada: "${rawQuery}" → "${query}"`
        );
      }
      logger.info('[Tool] propose_search_global_database | query:', query);

      const [insertedQuery] = await db
        .insert(searchQueries)
        .values({
          originalQuery: query,
          expandedQuery: 'source:openalex', // flag para pular RelevanceGate no Inngest
          status: 'proposed',
          userId: ctx.sessionUserId,
          chatId: ctx.chatId,
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
  });
}

/**
 * server/tools/propose-search.ts
 * P-07: Tool execute handlers extraídos de route.ts para manter SRP.
 * Estes módulos são importados pelo route.ts e injetados no streamText.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';
import { runStrategyAgent } from '@/server/agents/strategy-agent';
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
        // I-04: strategy-agent gera todas as queries a partir do topic
        let finalQueries = rawQueries;
        if (topic) {
          try {
            const strategy = await runStrategyAgent(topic, rawQueries);
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
      '(2) Nomes próprios em Português (ex: "Mermãs Digitais", "ProInfo") NÃO aparecem na literatura internacional — NUNCA os use como termo AND mandatório. Em vez disso, use os CONCEITOS que o projeto representa (ex: "digital inclusion" AND "women" AND education). ' +
      '(3) Se o usuário citou um projeto/programa, extraia os conceitos centrais e busque por eles. ' +
      '(4) Prefira queries simples e conceituais a queries booleanas complexas.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'String de busca em inglês com conceitos gerais. NÃO use nomes próprios em Português como AND mandatório (eles não aparecem no OpenAlex). Ex correto: "digital inclusion women education computing" ou "(\"digital literacy\" OR \"digital inclusion\") AND women AND education". Ex errado: "\"Mermãs Digitais\" AND education"'
        ),
    }),
    execute: async (input) => {
      const { query } = input;
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

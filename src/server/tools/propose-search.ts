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
    .optional()
    .describe(
      'Tópico central da pesquisa em linguagem natural (ex: "gamificação no ensino superior"). Usado para otimizar as queries via agente de estratégia.'
    ),
  queries: z
    .array(z.string())
    .describe(
      'Lista de strings de busca booleanas otimizadas separadas por idioma (ex: ["(\\"inteligência artificial\\") AND (educação)", "(\\"artificial intelligence\\") AND (education)"])'
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
      'Ferramenta para propor uma pesquisa bibliográfica ou mapeamento sistemático na SBC OpenLib. Passe as strings de busca pelo parâmetro "queries" desta ferramenta para renderizar a interface gráfica para o usuário.',
    inputSchema: searchSchema,
    execute: async (input: z.infer<typeof searchSchema>) => {
      const { queries: rawQueries, topic } = input;
      logger.info(
        `[Tool] propose_search_sol_database | ${rawQueries.length} queries | topic=${topic ?? 'n/a'}`
      );
      logger.debug('[Tool] queries brutas:', rawQueries);

      try {
        // ✅ I-04: strategy-agent refina as queries antes de salvar
        let finalQueries = rawQueries;
        if (topic) {
          try {
            const strategy = await runStrategyAgent(topic, rawQueries);
            finalQueries = strategy.queries;
            logger.info(
              `[Tool] StrategyAgent: ${rawQueries.length} → ${finalQueries.length} queries`
            );
            logger.debug('[Tool] queries refinadas:', finalQueries);
          } catch (err) {
            logger.warn('[Tool] StrategyAgent falhou, usando queries originais:', err);
          }
        }

        const originalCombined = rawQueries.join(' | ');
        const expandedCombined = finalQueries.join(' | ');
        const [insertedQuery] = await db
          .insert(searchQueries)
          .values({
            originalQuery: originalCombined,
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
      'Propõe uma busca na base científica global OpenAlex (ACM, IEEE) usando uma string simples em inglês. O usuário irá revisar o card de proposta e clicar em Executar no Front-end.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Termos de busca limpos em inglês. Ex: "software engineering gamification education"'
        ),
    }),
    execute: async (input) => {
      const { query } = input;
      logger.info('[Tool] propose_search_global_database | query:', query);

      const [insertedQuery] = await db
        .insert(searchQueries)
        .values({
          originalQuery: query,
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

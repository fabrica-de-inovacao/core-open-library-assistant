/**
 * server/tools/generate-review.ts
 * P-07: Tool execute handler para generate_systematic_review extraído de route.ts.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { rankArticles } from '@/lib/reranking';
import { runRerankerAgent } from '@/server/agents/reranker-agent';
import { runSynthesisAgent } from '@/server/agents/synthesis-agent';
import { formatArticleReference } from '@/lib/mappers/article';
import { logger } from '@/lib/logger';
import type { ToolContext } from './propose-search';

interface ReviewToolContext extends ToolContext {
  /** queryId ativo da request (usado como fallback retrocompat sem chatId) */
  queryId: string | null;
}

export function buildGenerateSystematicReviewTool(ctx: ReviewToolContext) {
  return tool({
    description:
      'Gera a revisão sistemática consolidada dos artigos já processados na pesquisa. CHAME ESTA FERRAMENTA imediatamente quando o usuário (ou o sistema) solicitar a síntese ou o resumo geral dos artigos encontrados.',
    // P-04 (Fase 1): removido query_id do inputSchema — a tool usa o chatId da closure.
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: async (_input) => {
      logger.info('[Tool] generate_systematic_review | chatId:', ctx.chatId);

      // Fase 1: busca todos os artigos de todas as queries deste chat
      let finishedArticles: (typeof articles.$inferSelect)[] = [];
      if (ctx.chatId) {
        const chatQueryIds = await db
          .select({ id: searchQueries.id, originalQuery: searchQueries.originalQuery })
          .from(searchQueries)
          .where(eq(searchQueries.chatId, ctx.chatId));

        if (chatQueryIds.length > 0) {
          finishedArticles = await db
            .select()
            .from(articles)
            .where(
              inArray(
                articles.queryId,
                chatQueryIds.map((q) => q.id)
              )
            );
        }
      } else if (ctx.queryId) {
        // Fallback retrocompatível (sem chatId)
        finishedArticles = await db
          .select()
          .from(articles)
          .where(eq(articles.queryId, ctx.queryId));
      }

      const readyArticles = finishedArticles.filter(
        (a) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      if (readyArticles.length === 0) {
        return {
          success: false,
          message: `Nenhum artigo com TL;DR encontrado. Status atual: ${finishedArticles.map((a) => a.status).join(', ') || 'nenhum'}. O processamento pode ainda estar em andamento — aguarde e tente novamente.`,
        };
      }

      // Busca todas as queries do chat e escolhe a primeira com originalQuery preenchido
      // (evita pegar uma query SOL com 0 resultados que pode ter originalQuery null)
      const topicRows = ctx.chatId
        ? await db
            .select({ originalQuery: searchQueries.originalQuery })
            .from(searchQueries)
            .where(eq(searchQueries.chatId, ctx.chatId))
        : await db
            .select({ originalQuery: searchQueries.originalQuery })
            .from(searchQueries)
            .where(eq(searchQueries.id, ctx.queryId ?? ''));
      const topic = topicRows.find((q) => q.originalQuery)?.originalQuery ?? '';

      // ✅ I-04: ranking composto (citações + recência)
      const initialRanked = rankArticles(readyArticles);

      // ✅ I-04: reranker agent (semântico via LLM)
      let finalRanked = initialRanked;
      try {
        finalRanked = await runRerankerAgent(initialRanked, topic);
      } catch (err) {
        logger.warn('[Tool] RerankerAgent falhou, usando ranking composto:', err);
      }

      // ✅ I-04: synthesis agent gera a revisão completa
      try {
        const { review, citationMap, articleCount } = await runSynthesisAgent(
          finalRanked,
          ctx.chatId ?? ctx.queryId ?? 'unknown'
        );
        return {
          success: true,
          total_articles: articleCount,
          review,
          citation_map: citationMap,
          instruction:
            'A revisão já foi gerada pelo agente de síntese. Apresente o conteúdo do campo "review" VERBATIM ao usuário, sem resumir ou parafrasear. Não adicione texto próprio.',
        };
      } catch (err) {
        logger.error('[Tool] SynthesisAgent falhou, usando fallback LLM:', err);
        // Fallback: retorna instruções para o LLM orquestrador gerar a síntese
        const topK = finalRanked.slice(0, 8);
        const citationMap = topK.map((art, idx) => formatArticleReference(art, idx + 1)).join('\n');
        const articlesContent = topK
          .map((art, idx) => {
            const body = art.markdownContent
              ? art.markdownContent.slice(0, 4000) +
                (art.markdownContent.length > 4000 ? '\n...[TRUNCATED]' : '')
              : `ABSTRACT/TL;DR: ${art.tldrContent}`;
            return `\n=== ARTIGO [${idx + 1}] — "${art.title}" ===\n${body}`;
          })
          .join('\n');
        return {
          success: true,
          total_articles: topK.length,
          synthesis_instructions: `Gere a revisão sistemática em Markdown seguindo a estrutura canônica SOL:\n\n1ª linha: # 📚 TL;DR Geral\nSeções em ##: Visão Geral e Contexto | Estratégias e Iniciativas Detalhadas (com ### subseções por tema) | Tabela Comparativa dos Artigos | Padrões, Divergências, Gaps e Oportunidades de Pesquisa (com ### Padrões Identificados, Divergências e Desafios, Gaps de Pesquisa, Oportunidades de Pesquisa).\nEncerre com parágrafo SEM heading convidando o usuário a aprofundar.\n\nCITAÇÕES:\n${citationMap}\n\nARTIGOS:\n${articlesContent}`,
        };
      }
    },
  });
}

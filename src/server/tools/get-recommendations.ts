/**
 * server/tools/get-recommendations.ts
 * Implementa a integração com a S2 Recommendations API (Phase 2).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import type { ToolContext } from './propose-search';

const recommendationsSchema = z.object({
  doi: z
    .string()
    .describe('DOI do artigo de origem para gerar recomendações (ex: 10.5753/sbsc.2024.12345)'),
  query_id: z
    .string()
    .describe('query_id ativo atual (obrigatório para vincular as recomendações)'),
  limit: z.number().min(1).max(10).default(5).describe('Número de recomendações a trazer'),
});

export function buildGetRecommendationsTool(ctx: ToolContext) {
  return tool({
    description:
      'Busca artigos recomendados baseados em um único artigo (via DOI) usando o motor de inteligência do Semantic Scholar, e adiciona os resultados à pesquisa.',
    inputSchema: recommendationsSchema,
    execute: async (input: z.infer<typeof recommendationsSchema>) => {
      const { doi, query_id, limit } = input;
      logger.info(
        `[Tool] get_recommendations | doi=${doi} | query_id=${query_id} | limit=${limit}`
      );

      try {
        const [query] = await db
          .select({ id: searchQueries.id })
          .from(searchQueries)
          .where(eq(searchQueries.id, query_id))
          .limit(1);

        if (!query) {
          return { success: false, error: 'query_id inválido ou não encontrado.' };
        }

        const s2Url = new URL(
          `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/DOI:${encodeURIComponent(doi)}`
        );
        s2Url.searchParams.set(
          'fields',
          'title,authors,year,externalIds,abstract,venue,isOpenAccess,tldr,authors.hIndex,authors.citationCount'
        );
        s2Url.searchParams.set('limit', limit.toString());

        const headers: Record<string, string> = { 'User-Agent': 'SOLAssistant/1.0' };
        if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
          headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
        }

        const s2Res = await fetch(s2Url.toString(), { headers });

        if (!s2Res.ok) {
          logger.error(`[Tool] get_recommendations falhou. HTTP ${s2Res.status}`);
          return { success: false, error: `Semantic Scholar API retornou HTTP ${s2Res.status}` };
        }

        type RecAuthor = { name?: string; hIndex?: number; citationCount?: number };
        type RecPaper = {
          title?: string;
          year?: number;
          externalIds?: { DOI?: string };
          abstract?: string;
          venue?: string;
          isOpenAccess?: boolean;
          tldr?: { text?: string };
          authors?: RecAuthor[];
        };

        const data = (await s2Res.json()) as { recommendedPapers?: RecPaper[] };
        const recommendedPapers = data.recommendedPapers ?? [];

        if (recommendedPapers.length === 0) {
          return { success: true, message: 'Nenhuma recomendação encontrada para este artigo.' };
        }

        const addedTitles: string[] = [];
        const insertedIds: string[] = [];

        for (const paper of recommendedPapers) {
          const recDoi = paper.externalIds?.DOI;
          if (!recDoi || !paper.title) continue;

          // Extrair info extra com h-index igual fizemos no Inngest
          const authorsStr =
            paper.authors
              ?.map((a) => {
                const parts = [a.name];
                if (a.hIndex !== undefined) parts.push(`h-index: ${a.hIndex}`);
                if (a.citationCount !== undefined) parts.push(`citations: ${a.citationCount}`);
                if (parts.length > 1) {
                  return `${parts[0]} (${parts.slice(1).join(', ')})`;
                }
                return parts[0] || 'Unknown';
              })
              .join(', ') || 'Desconhecido';

          const tldrText = paper.tldr?.text?.trim() || null;

          const [inserted] = await db
            .insert(articles)
            .values({
              queryId: query_id,
              doi: recDoi,
              title: paper.title,
              authors: authorsStr,
              publicationYear: paper.year,
              originalUrl: `https://doi.org/${recDoi}`,
              sourceName: paper.venue || 'Semantic Scholar',
              status: 'pending',
              abstract: paper.abstract || null,
              tldrContent: tldrText,
              metadataSource: 'semanticscholar',
              isOpenAccess: paper.isOpenAccess || false,
            })
            .onConflictDoNothing()
            .returning({ id: articles.id });

          if (inserted) {
            addedTitles.push(paper.title);
            insertedIds.push(inserted.id);
          }
        }

        if (insertedIds.length > 0) {
          const { inngest } = await import('@/server/inngest/client');
          await inngest.send({
            name: 'app/process.articles.batch',
            data: { query_id, article_ids: insertedIds, user_id: ctx.sessionUserId ?? 'anonymous' },
          });
        }

        return {
          success: true,
          added_count: insertedIds.length,
          total_recommendations: recommendedPapers.length,
          added_titles: addedTitles,
          message: `${insertedIds.length} de ${recommendedPapers.length} recomendações inéditas foram adicionadas ao acervo e começarão a ser processadas.`,
        };
      } catch (err) {
        logger.error('[Tool] get_recommendations falhou com erro:', err);
        return { success: false, error: 'Erro interno ao processar recomendações.' };
      }
    },
  });
}

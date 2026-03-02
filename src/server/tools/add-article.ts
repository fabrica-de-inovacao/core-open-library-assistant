/**
 * server/tools/add-article.ts
 * P-07: Tool execute handler para add_article_by_doi extraído de route.ts.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import type { ToolContext } from './propose-search';

const doiSchema = z.object({
  doi: z
    .string()
    .describe('DOI do artigo a ser adicionado manualmente (ex: 10.5753/sbsc.2024.12345)'),
  query_id: z.string().describe('query_id ativo atual para vincular o artigo recherché'),
});

export function buildAddArticleByDoiTool(_ctx: ToolContext) {
  return tool({
    description:
      'Adiciona manualmente um artigo à pesquisa atual usando o seu DOI. Busca metadados no CrossRef e dispara o processamento automático (TL;DR + extração).',
    inputSchema: doiSchema,
    execute: async (input: z.infer<typeof doiSchema>) => {
      const { doi, query_id } = input;
      logger.info(`[Tool] add_article_by_doi | doi=${doi} | query_id=${query_id}`);
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

        logger.info(`[Tool] add_article_by_doi OK | id=${inserted.id} | title=${title}`);
        return {
          success: true,
          title,
          authors,
          year,
          message: 'Artigo adicionado com sucesso! O processamento (TL;DR) começará em instantes.',
        };
      } catch (err) {
        logger.error('[Tool] add_article_by_doi falhou:', err);
        return { success: false, error: 'Erro ao buscar ou adicionar o artigo pelo DOI.' };
      }
    },
  });
}

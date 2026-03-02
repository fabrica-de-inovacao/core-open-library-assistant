import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { eq, inArray, and } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { auth } from '@/auth';
import { inngest } from '@/server/inngest/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

// F-04: 10 buscas por minuto por usuário/IP
const searchLimiter = rateLimit({ limit: 10, windowMs: 60_000 });

// Helper function to extract DOI from text or URL
function extractDoi(text: string): string | null {
  const doiRegex = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
  const match = text.match(doiRegex);
  return match ? match[1] : null;
}

const QuerySchema = z.object({
  userId: z.string().optional(), // In production this would come from the session context
});

export async function GET(request: Request) {
  try {
    const session = await auth();

    // F-04: Rate limiting — 10 req/min por usuário autenticado ou por IP
    const rateLimitKey = session?.user?.id ?? getClientIp(request);
    const rl = searchLimiter.check(rateLimitKey);
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { success: false, error: 'Muitas requisições. Aguarde antes de tentar novamente.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rl.resetAt),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const qs = searchParams.getAll('q').filter((q) => q.trim().length > 0);

    if (qs.length === 0) {
      return NextResponse.json(
        { success: false, error: { q: ['A query é obrigatória.'] } },
        { status: 400 }
      );
    }

    const queryResult = QuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!queryResult.success) {
      return NextResponse.json(
        { success: false, error: queryResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const combinedQuery = qs.join(' | ');
    const userId = session?.user?.id ?? null;
    console.log(
      `\n[SEARCH_VERIFY_V2] ⚡ NOVA BUSCA INICIADA: ${qs.length} queries | userId: ${userId ?? 'anon'}`
    );
    console.log(`[Search Trace] Referer:`, request.headers.get('referer'));
    console.log(`[Search Trace] User-Agent:`, request.headers.get('user-agent'));

    // 1. Cache check — if this exact run was already processed, reuse it
    const [existingQuery] = await db
      .select({
        id: searchQueries.id,
        status: searchQueries.status,
        originalQuery: searchQueries.originalQuery,
      })
      .from(searchQueries)
      .where(eq(searchQueries.originalQuery, combinedQuery))
      .limit(1);

    let queryId = searchParams.get('query_id');

    if (existingQuery && existingQuery.status === 'done') {
      console.log(`[Search] ✅ Cache hit! Query existente: ${existingQuery.id}`);
      const cachedArticles = await db
        .select()
        .from(articles)
        .where(eq(articles.queryId, existingQuery.id));

      let finalQueryId = existingQuery.id;

      if (queryId && queryId !== existingQuery.id) {
        console.log(
          `[Search] 🔄 Copiando ${cachedArticles.length} artigos em cache para o novo queryId: ${queryId}`
        );
        if (cachedArticles.length > 0) {
          await db.insert(articles).values(
            cachedArticles.map((art) => ({
              queryId: queryId as string,
              doi: art.doi,
              title: art.title,
              authors: art.authors,
              sourceName: art.sourceName,
              publicationYear: art.publicationYear,
              originalUrl: art.originalUrl,
              status: art.status, // Keep as 'done' or 'abstract_only'
              markdownContent: art.markdownContent,
              tldrContent: art.tldrContent,
              abstract: art.abstract,
              keywords: art.keywords,
              citationCount: art.citationCount,
              publisher: art.publisher,
              isOpenAccess: art.isOpenAccess,
              metadataSource: art.metadataSource,
            }))
          );
        }
        await db.update(searchQueries).set({ status: 'done' }).where(eq(searchQueries.id, queryId));
        finalQueryId = queryId;
      }

      return NextResponse.json({
        success: true,
        query: combinedQuery,
        query_id: finalQueryId,
        total_found: cachedArticles.length,
        cached: true,
        message: 'Resultados reutilizados do cache. Cópias geradas para o novo ID se fornecido.',
      });
    }

    // 2. Create or Update SearchQuery Tracking Record in DB
    if (queryId) {
      await db
        .update(searchQueries)
        .set({ status: 'searching' })
        .where(eq(searchQueries.id, queryId));
      console.log(`[Search] 📝 QueryID recebido e atualizado para searching: ${queryId}`);
    } else {
      const [insertedQuery] = await db
        .insert(searchQueries)
        .values({
          originalQuery: combinedQuery,
          status: 'searching',
          userId: userId || null,
        })
        .returning();
      queryId = insertedQuery.id;
      console.log(`[Search] 📝 QueryID criado: ${queryId}`);
    }

    // 2. Scraping Logic
    const allResults: Array<{
      title: string;
      authors: string;
      year: number;
      originalUrl: string;
      sourceName: string;
      doi: string | null;
    }> = [];
    const MAX_PAGES = 2; // Pages 1 and 2 per sub-query
    const MAX_TOTAL_RESULTS = 25;

    for (const q of qs) {
      if (allResults.length >= MAX_TOTAL_RESULTS) break;

      console.log(`[Search] 🔎 Buscando fragmento: "${q}"`);
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (allResults.length >= MAX_TOTAL_RESULTS) break;

        // SOL new search endpoint (OHS - Open Harvesting Systems)
        // archiveIds: 1=Anais de Eventos, 2=Periódicos, 3=Livros e Relatórios
        const searchUrl = `https://sol.sbc.org.br/busca/index.php/integrada/results?query=${encodeURIComponent(q)}&archiveIds%5B%5D=1&archiveIds%5B%5D=2&archiveIds%5B%5D=3&page=${page}`;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20_000);

          const response = await fetch(searchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          if (!response.ok) {
            console.warn(
              `[Search] ❌ Falha ao acessar a página ${page} da SOL: Status ${response.status}`
            );
            continue;
          }

          const html = await response.text();
          console.log(
            `[Search] 🌐 SOL página ${page} OK | HTTP ${response.status} | HTML length: ${html.length} chars`
          );
          const $ = cheerio.load(html);

          // New SOL DOM structure (2024+):
          // Articles are NOT wrapped in a single container per item.
          // Each article is represented by a sequence of sibling elements:
          //   - a.record_title  → title + link
          //   - div.recordContents  → authors, date, source
          //
          // Strategy: iterate over each a.record_title and read the next sibling.
          $('a.record_title').each((i, el) => {
            if (allResults.length >= MAX_TOTAL_RESULTS) return; // Break cheerio each

            const titleEl = $(el);
            const title = titleEl.text().trim();
            const url = titleEl.attr('href') || '';

            // The next sibling after a.record_title is div.recordContents
            const contents = titleEl.next('div.recordContents');
            const authors = contents.find('span.author').text().trim();
            const yearText = contents.find('span.list_record_date').text().trim();
            const yearMatch = yearText.match(/\d{4}/);
            const year = yearMatch ? parseInt(yearMatch[0], 10) : new Date().getFullYear();
            const sourceName = contents.find('div.archive_serie').text().trim() || 'SBC OpenLib';
            const doi = extractDoi(titleEl.text() + ' ' + url);

            // Avoid adding identical URLs across different sub-queries
            if (title && url && !allResults.some((r) => r.originalUrl === url)) {
              allResults.push({
                title,
                authors: authors || 'Desconhecido',
                year,
                originalUrl: url,
                sourceName,
                doi,
              });
            }
          });

          const matchedSelector = $('a.record_title').length;
          console.log(
            `[Search] 🔍 Seletor a.record_title encontrou ${matchedSelector} elementos | Artigos válidos e únicos até agora: ${allResults.length}`
          );

          // If this page returned nothing, no point fetching further pages for this sub-query
          if (matchedSelector === 0) break;
        } catch (pageError) {
          const isAbort = (pageError as Error).name === 'AbortError';
          console.warn(
            `[Search] ⏱️ Página ${page} ${isAbort ? 'timeout (20s)' : 'erro'}: ${(pageError as Error).message}`
          );
          // Don't break — we might have results from previous pages
          continue;
        }
      }
    }

    // Cap at 25 results
    const limitedResults = allResults.slice(0, 25);

    // 3. Insert into Database with DOI deduplication
    console.log(`[Search] 📊 Total após scraping: ${limitedResults.length} artigos`);

    const newArticleIds: string[] = [];

    if (limitedResults.length > 0) {
      // --- DOI dedup: find articles already processed with these DOIs or URLs ---
      const knownDois = limitedResults.map((r) => r.doi).filter(Boolean) as string[];

      type ExistingArticle = {
        id: string;
        doi: string | null;
        originalUrl: string | null;
        title: string | null;
        authors: string | null;
        sourceName: string | null;
        publicationYear: number | null;
        status: string | null;
        markdownContent: string | null;
        tldrContent: string | null;
        abstract: string | null;
        keywords: string | null;
        citationCount: number | null;
        publisher: string | null;
        isOpenAccess: boolean | null;
        metadataSource: string | null;
      };

      // Fetch any already-processed articles matching these DOIs or URLs
      let alreadyProcessed: ExistingArticle[] = [];
      if (knownDois.length > 0) {
        alreadyProcessed = (await db
          .select()
          .from(articles)
          .where(inArray(articles.doi, knownDois))) as ExistingArticle[];
        // Keep only truly finished ones
        alreadyProcessed = alreadyProcessed.filter(
          (a) => a.status === 'done' || a.status === 'abstract_only'
        );
      }

      const processedByDoi = new Map(alreadyProcessed.map((a) => [a.doi, a]));
      const processedByUrl = new Map(alreadyProcessed.map((a) => [a.originalUrl, a]));

      // Partition results into cached (reuse data) vs fresh (need extraction)
      const toInsertFresh: typeof limitedResults = [];
      const toInsertCached: ExistingArticle[] = [];

      for (const art of limitedResults) {
        const existing =
          (art.doi && processedByDoi.get(art.doi)) || processedByUrl.get(art.originalUrl);
        if (existing) {
          toInsertCached.push(existing);
        } else {
          toInsertFresh.push(art);
        }
      }

      console.log(
        `[Search] ♻️ ${toInsertCached.length} artigos em cache (DOI match) | ${toInsertFresh.length} artigos novos para extração`
      );

      // Insert cached articles directly (already processed — no Inngest needed)
      if (toInsertCached.length > 0) {
        const cachedRows = toInsertCached.map((src) => ({
          queryId: queryId as string,
          doi: src.doi ?? undefined,
          title: src.title ?? '',
          authors: src.authors ?? 'Desconhecido',
          sourceName: src.sourceName ?? undefined,
          publicationYear: src.publicationYear ?? undefined,
          originalUrl: src.originalUrl ?? '',
          status: (src.status ?? 'done') as 'done' | 'abstract_only',
          markdownContent: src.markdownContent ?? undefined,
          tldrContent: src.tldrContent ?? undefined,
          abstract: src.abstract ?? undefined,
          keywords: src.keywords ?? undefined,
          citationCount: src.citationCount ?? undefined,
          publisher: src.publisher ?? undefined,
          isOpenAccess: src.isOpenAccess ?? undefined,
          metadataSource: src.metadataSource ?? undefined,
        }));
        await db.insert(articles).values(cachedRows).onConflictDoNothing();
        console.log(`[Search] ✅ ${cachedRows.length} artigos em cache inseridos sem re-extração`);
      }

      // Insert fresh articles (need Inngest processing)
      if (toInsertFresh.length > 0) {
        await db
          .insert(articles)
          .values(
            toInsertFresh.map((art) => ({
              queryId: queryId,
              doi: art.doi,
              title: art.title,
              authors: art.authors,
              sourceName: art.sourceName,
              publicationYear: art.year,
              originalUrl: art.originalUrl,
              status: 'pending' as const,
            }))
          )
          .onConflictDoNothing();
        console.log(
          `[Search] ✅ ${toInsertFresh.length} artigos novos inseridos com status pending`
        );

        // Fetch only the pending IDs (fresh ones) to dispatch to Inngest
        const pendingArticles = await db
          .select({ id: articles.id })
          .from(articles)
          .where(and(eq(articles.queryId, queryId as string), eq(articles.status, 'pending')));
        newArticleIds.push(...pendingArticles.map((a) => a.id));
      }
    } else {
      console.warn(`[Search] ⚠️ Nenhum artigo encontrado — DB insert ignorado`);
    }

    // Update query status to processing (wait for queue to pick it up later)
    await db
      .update(searchQueries)
      .set({ status: 'processing' })
      .where(eq(searchQueries.id, queryId));

    // Queue integration (Inngest Fan-Out) — only dispatch truly new (pending) articles
    if (newArticleIds.length > 0) {
      const batchSize = 3;
      const events = [];
      for (let i = 0; i < newArticleIds.length; i += batchSize) {
        const batch = newArticleIds.slice(i, i + batchSize);
        events.push({
          name: 'app/process.articles.batch',
          data: {
            query_id: queryId,
            article_ids: batch,
          },
        });
      }

      await inngest.send(events);
      console.log(
        `[Search] 🚀 ${events.length} evento(s) enviados ao Inngest com ${newArticleIds.length} artigo(s) novos`
      );
    } else if (limitedResults.length > 0) {
      // All articles were served from cache — mark query as done immediately
      await db.update(searchQueries).set({ status: 'done' }).where(eq(searchQueries.id, queryId));
      console.log(`[Search] ✅ Todos os artigos vieram do cache — query marcada como done`);
    }

    return NextResponse.json({
      success: true,
      query: combinedQuery,
      total_found: limitedResults.length,
      results: limitedResults,
      query_id: queryId,
    });
  } catch (error: unknown) {
    console.error('Error in /api/search:', error);
    return NextResponse.json(
      { success: false, error: 'Ocorreu um erro interno durante a busca.' },
      { status: 500 }
    );
  }
}

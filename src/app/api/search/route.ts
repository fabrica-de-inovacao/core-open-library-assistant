import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { auth } from '@/auth';

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
    console.log(`\n[Search] ⚡ Nova busca: ${qs.length} queries | userId: ${userId ?? 'anon'}`);

    // 1. Cache check — if this exact run was already processed, reuse it
    const [existingQuery] = await db
      .select()
      .from(searchQueries)
      .where(eq(searchQueries.originalQuery, combinedQuery))
      .limit(1);

    if (existingQuery && existingQuery.status === 'done') {
      console.log(`[Search] ✅ Cache hit! Reutilizando query existente: ${existingQuery.id}`);
      const cachedArticles = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.queryId, existingQuery.id));
      return NextResponse.json({
        success: true,
        query: combinedQuery,
        query_id: existingQuery.id,
        total_found: cachedArticles.length,
        cached: true,
        message: 'Resultados reutilizados do cache. Nenhum processamento adicional necessário.',
      });
    }

    // 2. Create a new SearchQuery Tracking Record in DB
    const [insertedQuery] = await db
      .insert(searchQueries)
      .values({
        originalQuery: combinedQuery,
        status: 'searching',
        userId: userId || null,
      })
      .returning();

    const queryId = insertedQuery.id;
    console.log(`[Search] 📝 QueryID criado: ${queryId}`);

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

    // 3. Insert into Database
    console.log(`[Search] 📊 Total após scraping: ${limitedResults.length} artigos`);
    if (limitedResults.length > 0) {
      await db
        .insert(articles)
        .values(
          limitedResults.map((art) => ({
            queryId: queryId,
            doi: art.doi,
            title: art.title,
            authors: art.authors,
            sourceName: art.sourceName,
            publicationYear: art.year,
            originalUrl: art.originalUrl,
            status: 'pending',
          }))
        )
        .onConflictDoNothing();
      console.log(
        `[Search] ✅ ${limitedResults.length} artigos inseridos no DB com queryId=${queryId}`
      );
    } else {
      console.warn(`[Search] ⚠️ Nenhum artigo encontrado — DB insert ignorado`);
    }

    // Update query status to processing (wait for queue to pick it up later)
    await db
      .update(searchQueries)
      .set({ status: 'processing' })
      .where(eq(searchQueries.id, queryId));

    // Queue integration (Inngest Fan-Out pattern)
    // Send in batches of 5
    if (limitedResults.length > 0) {
      // Find the generated IDs for the articles inserted for this query
      const insertedArticles = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.queryId, queryId));
      const articleIds = insertedArticles.map((a) => a.id);

      const batchSize = 3;
      const events = [];
      for (let i = 0; i < articleIds.length; i += batchSize) {
        const batch = articleIds.slice(i, i + batchSize);
        events.push({
          name: 'app/process.articles.batch',
          data: {
            query_id: queryId,
            article_ids: batch,
          },
        });
      }

      // We dynamically import to avoid messing up edge handlers if any, but regular import is fine too if handled correctly
      const { inngest } = await import('@/server/inngest/client');
      await inngest.send(events);
      console.log(
        `[Search] 🚀 ${events.length} evento(s) enviados ao Inngest com ${articleIds.length} artigo(s) total`
      );
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

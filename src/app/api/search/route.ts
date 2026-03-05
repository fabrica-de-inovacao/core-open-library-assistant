import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { eq, inArray, and, sql } from 'drizzle-orm';
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

// Helper: busca uma página do SOL e retorna os resultados encontrados.
// Isolado para permitir execução paralela via Promise.allSettled.
async function fetchSOLPage(
  q: string,
  page: number
): Promise<
  Array<{
    title: string;
    authors: string;
    year: number;
    originalUrl: string;
    sourceName: string;
    doi: string | null;
  }>
> {
  const searchUrl = `https://sol.sbc.org.br/busca/index.php/integrada/results?query=${encodeURIComponent(q)}&archiveIds%5B%5D=1&archiveIds%5B%5D=2&archiveIds%5B%5D=3&page=${page}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.warn(`[Search] ❌ SOL q="${q.slice(0, 30)}" pág.${page}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    console.log(`[Search] 🌐 SOL q="${q.slice(0, 30)}" pág.${page} | HTML ${html.length} chars`);

    const $ = cheerio.load(html);
    const results: Array<{
      title: string;
      authors: string;
      year: number;
      originalUrl: string;
      sourceName: string;
      doi: string | null;
    }> = [];

    $('a.record_title').each((_, el) => {
      const titleEl = $(el);
      const title = titleEl.text().trim();
      const url = titleEl.attr('href') || '';
      const contents = titleEl.next('div.recordContents');
      const authors = contents.find('span.author').text().trim();
      const yearText = contents.find('span.list_record_date').text().trim();
      const yearMatch = yearText.match(/\d{4}/);
      const year = yearMatch ? parseInt(yearMatch[0], 10) : new Date().getFullYear();
      const sourceName = contents.find('div.archive_serie').text().trim() || 'SBC OpenLib';
      const doi = extractDoi(titleEl.text() + ' ' + url);
      if (title && url) {
        results.push({
          title,
          authors: authors || 'Desconhecido',
          year,
          originalUrl: url,
          sourceName,
          doi,
        });
      }
    });

    console.log(`[Search] 🔍 SOL q="${q.slice(0, 30)}" pág.${page}: ${results.length} artigo(s)`);
    return results;
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    console.warn(
      `[Search] ⏱️ SOL q="${q.slice(0, 30)}" pág.${page} ${isAbort ? 'timeout (20s)' : 'erro'}: ${(err as Error).message}`
    );
    return [];
  }
}

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

    // NOTA: O cache de query-level foi removido intencionalmente.
    // Motivo: _checkAndMarkQueryDone marca 'done' mesmo quando todos os artigos são 'failed',
    // o que fazia com que buscas com resultados ruins fossem reutilizadas indefinidamente.
    // A deduplicação por DOI (abaixo, seção 3) continua ativa — artigos já processados
    // individualmente são reutilizados sem re-extração. Isso é suficiente e seguro.

    // 1. Determinar queryId
    let queryId = searchParams.get('query_id');

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

    // 2. Scraping Logic — todas as páginas em paralelo (G1: elimina serial await-in-loop)
    const MAX_PAGES = 2; // páginas 1 e 2 por sub-query
    const MAX_TOTAL_RESULTS = 25;

    console.log(`[Search] 🚀 Buscando ${qs.length} queries × ${MAX_PAGES} páginas em paralelo`);
    const tasks = qs.flatMap((q) => [1, 2].map((page) => fetchSOLPage(q, page)));
    const settled = await Promise.allSettled(tasks);

    // Merge com dedup por URL
    const seenUrls = new Set<string>();
    const allResults: Array<{
      title: string;
      authors: string;
      year: number;
      originalUrl: string;
      sourceName: string;
      doi: string | null;
    }> = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        if (!seenUrls.has(item.originalUrl) && allResults.length < MAX_TOTAL_RESULTS) {
          seenUrls.add(item.originalUrl);
          allResults.push(item);
        }
      }
    }

    // Cap at user-defined limit (default 25, allowed: 10 | 25)
    const rawLimit = Number(searchParams.get('limit') ?? '25');
    const articleLimit = [10, 25].includes(rawLimit) ? rawLimit : 25;
    // Idioma para geração de TL;DRs (passado pelo cliente via useUserSettings)
    const tldrLang = searchParams.get('tldr_lang') ?? 'pt-BR';

    const limitedResults = allResults.slice(0, articleLimit);
    console.log(
      `[Search] \uD83D\uDCCA Limite de artigos: ${articleLimit} | Idioma TL;DR: ${tldrLang} | Total: ${limitedResults.length}`
    );

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

      // P-10: onConflictDoUpdate atualiza metadata enriquecida caso o artigo já exista
      // na mesma query (busca re-executada ou duplicata via URL).
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
        await db
          .insert(articles)
          .values(cachedRows)
          .onConflictDoUpdate({
            target: [articles.queryId, articles.originalUrl],
            set: {
              status: sql`excluded.status`,
              tldrContent: sql`excluded.tldr_content`,
              markdownContent: sql`excluded.markdown_content`,
              abstract: sql`excluded.abstract`,
              keywords: sql`excluded.keywords`,
              citationCount: sql`excluded.citation_count`,
              publisher: sql`excluded.publisher`,
              isOpenAccess: sql`excluded.is_open_access`,
              metadataSource: sql`excluded.metadata_source`,
              updatedAt: sql`now()`,
            },
          });
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

    // Pré-verificação de quantidade mínima:
    // Se a busca retornou menos de 5 artigos no total (incluindo cached), não há material
    // suficiente para uma revisão sistemática significativa. Evita desperdiçar processamento
    // (TL;DR, embeddings, PDF extraction) em resultados claramente insuficientes.
    const MIN_USEFUL_ARTICLES = 5;
    if (limitedResults.length > 0 && limitedResults.length < MIN_USEFUL_ARTICLES) {
      // Marca os artigos pending como failed para evitar loading infinito na UI.
      // O Inngest não será acionado — sem este update os artigos ficariam presos em 'pending'.
      await db
        .update(articles)
        .set({ status: 'failed' })
        .where(and(eq(articles.queryId, queryId as string), eq(articles.status, 'pending')));
      await db
        .update(searchQueries)
        .set({ status: 'needs_refinement' })
        .where(eq(searchQueries.id, queryId));
      console.log(
        `[Search] ⚠️ Poucos resultados (${limitedResults.length} < ${MIN_USEFUL_ARTICLES}) — needs_refinement, artigos marcados como failed, Inngest não acionado`
      );
      return NextResponse.json({
        success: true,
        query: combinedQuery,
        total_found: limitedResults.length,
        results: limitedResults,
        query_id: queryId,
        needs_refinement: true,
        reason: 'low_count',
      });
    }

    // Update query status to processing (wait for queue to pick it up later)
    await db
      .update(searchQueries)
      .set({ status: 'processing' })
      .where(eq(searchQueries.id, queryId));

    // Queue integration — 1 único evento com todos os artigos (G2: RelevanceGate roda
    // apenas 1× no processArticlesBatch em vez de 1× por lote de 3 artigos).
    if (newArticleIds.length > 0) {
      await inngest.send({
        name: 'app/process.articles.batch' as const,
        data: {
          query_id: queryId,
          article_ids: newArticleIds,
          tldr_lang: tldrLang,
          user_id: userId ?? 'anonymous',
        },
      });
      console.log(
        `[Search] 🚀 1 evento enviado ao Inngest com ${newArticleIds.length} artigo(s) | query_id=${queryId}`
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

import { NextResponse } from 'next/server';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { OpenAlexResponseSchema } from '@/lib/schemas/openalex';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

// F-04: 10 buscas globais por minuto por usuário/IP
const globalSearchLimiter = rateLimit({ limit: 10, windowMs: 60_000 });

// ---------------------------------------------------------------------------
// Local types (internal mapping layer)
// ---------------------------------------------------------------------------

interface MappedArticle {
  title: string;
  authors: string;
  year: number | null;
  originalUrl: string;
  sourceName: string;
  doi: string | null;
  citationCount: number | null;
  keywords: string | null;
}

// ---------------------------------------------------------------------------
// OpenAlex integration
// ---------------------------------------------------------------------------

const OPENALEX_SELECT =
  'id,title,authorships,publication_year,doi,primary_location,cited_by_count,keywords';

const USER_AGENT = 'SOLAssistant/1.0 (mailto:dev@solassistant.app)';

// ID do campo Computer Science no OpenAlex: https://api.openalex.org/fields/17
const CS_FIELD_ID = '17';

// IDs dos publishers no OpenAlex — verificar em https://api.openalex.org/publishers?search=<nome>
// ACM  (Association for Computing Machinery):        P4310319798  → 164 k works
// IEEE (Institute of Electrical and Electronics):    P4310319808  → 1,47 M works
//       (cobre todas as IEEE societies via lineage, ex: IEEE Computer Society P4310320439)
// Springer Nature (grupo pai):                       P4310319965  → 2,75 M works
//       (cobre Springer Nature Netherlands P4310320108 via lineage)
const PUBLISHER_FILTER =
  'primary_location.source.host_organization_lineage:P4310319798|P4310319808|P4310319965';

/**
 * Normaliza a query antes de enviar ao OpenAlex.
 * Principal problema: o LLM às vezes gera `""Termo""` (double-double-quotes)
 * que o OpenAlex não entende — converte para `"Termo"`.
 */
function normalizeOpenAlexQuery(raw: string): string {
  return raw.replace(/""([^"]+)""/g, '"$1"').trim();
}

/**
 * Gera uma query de fallback removendo termos próprios com caracteres não-ASCII
 * (ex: "Mermãs Digitais", "Sereias Digitais") que dificilmente aparecem
 * na literatura acadêmica indexada pelo OpenAlex.
 * Mantém apenas os termos conceituais em inglês.
 */
function buildFallbackQuery(query: string): string | null {
  // Só vale a pena se a query tem operadores booleanos
  const hasBoolean = /\b(AND|OR|NOT)\b/.test(query);
  if (!hasBoolean) return null;

  // Remove termos entre aspas que contêm caracteres não-ASCII (nomes próprios em Pt-BR)
  let stripped = query.replace(/"[^"]*[^\x00-\x7F][^"]*"(\s+(AND|OR)\s*)?/gi, '');

  // Limpa operadores booleanos órfãos no início/fim
  stripped = stripped
    .replace(/^\s*(AND|OR)\s+/i, '')
    .replace(/\s+(AND|OR)\s*$/i, '')
    .replace(/\(\s*\)/g, '') // parênteses vazios
    .replace(/\s{2,}/g, ' ')
    .trim();

  return stripped && stripped !== query && stripped.length > 3 ? stripped : null;
}

/** Executa uma requisição ao OpenAlex e retorna os artigos mapeados. */
async function doOpenAlexFetch(
  query: string,
  filterCS: boolean,
  attempt: number,
  perPage: number = 25
): Promise<{ articles: MappedArticle[]; totalCount: number }> {
  const filters: string[] = ['type:article', PUBLISHER_FILTER];
  if (filterCS) filters.push(`topics.field.id:${CS_FIELD_ID}`);

  const url =
    `https://api.openalex.org/works` +
    `?search=${encodeURIComponent(query)}` +
    `&filter=${filters.join(',')}` +
    `&per-page=${perPage}` +
    `&select=${OPENALEX_SELECT}`;

  logger.log(`[GlobalSearch] 🌐 OpenAlex tentativa ${attempt} | CS=${filterCS} | ${url}`);

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    throw new Error(`OpenAlex API returned ${response.status}: ${response.statusText}`);
  }

  const rawData = await response.json();
  const parsed = OpenAlexResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    logger.warn('[GlobalSearch] ⚠️ OpenAlex response schema inválido:', parsed.error.issues);
    return { articles: [], totalCount: 0 };
  }

  const data = parsed.data;
  const totalCount = data.meta?.count ?? 0;
  logger.log(
    `[GlobalSearch] ✅ Tentativa ${attempt}: ${data.results?.length ?? 0} / ${totalCount} resultados`
  );

  const articles = data.results.map((work): MappedArticle => {
    const authors =
      work.authorships
        .map((a) => a.author.display_name)
        .filter(Boolean)
        .join('; ') || 'Desconhecido';

    const doiRaw = work.doi ?? null;
    const doi = doiRaw ? doiRaw.replace(/^https?:\/\/doi\.org\//i, '') : null;

    const landingUrl =
      work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : null) ?? work.id;

    const sourceName = work.primary_location?.source?.display_name ?? 'OpenAlex';

    const keywords =
      work.keywords && work.keywords.length > 0
        ? work.keywords
            .map((k) => k.keyword)
            .filter(Boolean)
            .join(', ')
        : null;

    return {
      title: work.title ?? '(sem título)',
      authors,
      year: work.publication_year ?? null,
      originalUrl: landingUrl,
      sourceName,
      doi,
      citationCount: work.cited_by_count ?? null,
      keywords,
    };
  });

  return { articles, totalCount };
}

/**
 * Busca artigos no OpenAlex com estratégia de 3 tentativas progressivas:
 * 1. Query normalizada + filtro Computer Science (mais preciso)
 * 2. Query normalizada sem filtro de área (mais abrangente)
 * 3. Query de fallback (sem nomes próprios não-ASCII) + filtro CS
 *
 * Isso resolve o problema de queries como `"Mermãs Digitais" AND (...)` que
 * retornam 0 resultados porque o nome próprio não existe na literatura indexada.
 */
async function fetchOpenAlexWorks(
  query: string,
  articleLimit: number = 25
): Promise<MappedArticle[]> {
  const cleanQuery = normalizeOpenAlexQuery(query);
  logger.log(`[GlobalSearch] Query normalizada: "${cleanQuery}"`);

  // Tentativa 1: com filtro CS
  const attempt1 = await doOpenAlexFetch(cleanQuery, true, 1, articleLimit);
  if (attempt1.articles.length > 0) return attempt1.articles;

  // Tentativa 2: sem filtro CS (mesma query, mais abrangente)
  const attempt2 = await doOpenAlexFetch(cleanQuery, false, 2, articleLimit);
  if (attempt2.articles.length > 0) return attempt2.articles;

  // Tentativa 3: fallback removendo nomes próprios não-ASCII + filtro CS
  const fallbackQuery = buildFallbackQuery(cleanQuery);
  if (fallbackQuery) {
    logger.log(`[GlobalSearch] 🔄 Fallback query (sem nomes próprios): "${fallbackQuery}"`);

    const attempt3 = await doOpenAlexFetch(fallbackQuery, true, 3, articleLimit);
    if (attempt3.articles.length > 0) return attempt3.articles;

    // Tentativa 4: fallback sem filtro CS
    const attempt4 = await doOpenAlexFetch(fallbackQuery, false, 4, articleLimit);
    if (attempt4.articles.length > 0) return attempt4.articles;
  }

  logger.warn(`[GlobalSearch] ⚠️ Nenhum resultado após todas as tentativas para: "${cleanQuery}"`);
  return [];
}

// ---------------------------------------------------------------------------
// GET /api/search/global?q=...&query_id=...
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await auth();

    // F-04: Rate limiting — 10 req/min por usuário autenticado ou por IP
    const rateLimitKey = session?.user?.id ?? getClientIp(request);
    const rl = globalSearchLimiter.check(rateLimitKey);
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

    const q = searchParams.get('q')?.trim() ?? '';
    if (!q) {
      return NextResponse.json(
        { success: false, error: { q: ['A query é obrigatória.'] } },
        { status: 400 }
      );
    }

    let queryId = searchParams.get('query_id');
    const userId = session?.user?.id ?? null;

    // Fase 7 (P-settings): respeita limite de artigos configurado pelo usuário
    const rawLimit = Number(searchParams.get('limit') ?? '25');
    const articleLimit = [10, 25].includes(rawLimit) ? rawLimit : 25;

    logger.log(
      `[GlobalSearch] ⚡ Nova busca global | query: "${q}" | queryId: ${queryId ?? 'novo'} | userId: ${userId ?? 'anon'}`
    );

    // 1. Create or update SearchQuery tracking record
    if (queryId) {
      await db
        .update(searchQueries)
        .set({ status: 'searching', expandedQuery: 'source:openalex' })
        .where(eq(searchQueries.id, queryId));
      logger.log(`[GlobalSearch] 📝 QueryID recebido e atualizado para searching: ${queryId}`);
    } else {
      const [inserted] = await db
        .insert(searchQueries)
        .values({
          originalQuery: q,
          expandedQuery: 'source:openalex', // flag para pular RelevanceGate no Inngest
          status: 'searching',
          userId: userId ?? null,
        })
        .returning();
      queryId = inserted.id;
      logger.log(`[GlobalSearch] 📝 QueryID criado: ${queryId}`);
    }

    // 2. Fetch from OpenAlex
    let allResults: MappedArticle[] = [];
    try {
      allResults = await fetchOpenAlexWorks(q, articleLimit);
    } catch (fetchError) {
      logger.warn(
        `[GlobalSearch] ❌ Falha ao buscar no OpenAlex: ${(fetchError as Error).message}`
      );
      await db.update(searchQueries).set({ status: 'failed' }).where(eq(searchQueries.id, queryId));
      return NextResponse.json(
        {
          success: false,
          error: 'Falha ao consultar o OpenAlex. Tente novamente mais tarde.',
          query_id: queryId,
        },
        { status: 502 }
      );
    }

    // Garante que o número de resultados não ultrapassa o limite configurado pelo usuário
    allResults = allResults.slice(0, articleLimit);
    logger.log(
      `[GlobalSearch] 📊 Limite aplicado: ${articleLimit} | Resultados: ${allResults.length}`
    );

    // 3. DOI deduplication — reuse already-processed articles to avoid redundant extraction
    const newArticleIds: string[] = [];

    if (allResults.length > 0) {
      const knownDois = allResults.map((r) => r.doi).filter(Boolean) as string[];

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

      let alreadyProcessed: ExistingArticle[] = [];
      if (knownDois.length > 0) {
        alreadyProcessed = (await db
          .select()
          .from(articles)
          .where(inArray(articles.doi, knownDois))) as ExistingArticle[];
        alreadyProcessed = alreadyProcessed.filter(
          (a) => a.status === 'done' || a.status === 'abstract_only'
        );
      }

      const processedByDoi = new Map(alreadyProcessed.map((a) => [a.doi, a]));
      const processedByUrl = new Map(alreadyProcessed.map((a) => [a.originalUrl, a]));

      const toInsertFresh: MappedArticle[] = [];
      const toInsertCached: ExistingArticle[] = [];

      for (const art of allResults) {
        const existing =
          (art.doi && processedByDoi.get(art.doi)) || processedByUrl.get(art.originalUrl);
        if (existing) {
          toInsertCached.push(existing);
        } else {
          toInsertFresh.push(art);
        }
      }

      logger.log(
        `[GlobalSearch] ♻️ ${toInsertCached.length} do cache | ${toInsertFresh.length} novos para extração`
      );

      // P-10: onConflictDoUpdate atualiza metadata enriquecida se o artigo já existir
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
        logger.log(`[GlobalSearch] ✅ ${cachedRows.length} artigos do cache inseridos`);
      }

      // Insert fresh articles as pending (Inngest will process them)
      if (toInsertFresh.length > 0) {
        await db
          .insert(articles)
          .values(
            toInsertFresh.map((art) => ({
              queryId: queryId as string,
              doi: art.doi ?? undefined,
              title: art.title,
              authors: art.authors,
              sourceName: art.sourceName,
              publicationYear: art.year ?? undefined,
              originalUrl: art.originalUrl,
              status: 'pending' as const,
              keywords: art.keywords ?? undefined,
              citationCount: art.citationCount ?? undefined,
              metadataSource: 'openalex' as const,
            }))
          )
          .onConflictDoNothing();
        logger.log(
          `[GlobalSearch] ✅ ${toInsertFresh.length} artigos novos inseridos como pending`
        );

        const pendingArticles = await db
          .select({ id: articles.id })
          .from(articles)
          .where(and(eq(articles.queryId, queryId as string), eq(articles.status, 'pending')));
        newArticleIds.push(...pendingArticles.map((a) => a.id));
      }
    } else {
      logger.warn(`[GlobalSearch] ⚠️ Nenhum artigo encontrado no OpenAlex para: "${q}"`);
    }

    // 4. Update query status + dispatch Inngest fan-out
    await db
      .update(searchQueries)
      .set({ status: 'processing' })
      .where(eq(searchQueries.id, queryId));

    if (newArticleIds.length > 0) {
      const batchSize = 3;
      const events = [];
      for (let i = 0; i < newArticleIds.length; i += batchSize) {
        const batch = newArticleIds.slice(i, i + batchSize);
        events.push({
          name: 'app/process.articles.batch' as const,
          data: {
            query_id: queryId,
            article_ids: batch,
            user_id: userId ?? 'anonymous',
          },
        });
      }
      const { inngest } = await import('@/server/inngest/client');
      await inngest.send(events);
      logger.log(
        `[GlobalSearch] 🚀 ${events.length} evento(s) Inngest enviados com ${newArticleIds.length} artigo(s)`
      );
    } else if (allResults.length > 0) {
      // All from cache — mark done immediately
      await db.update(searchQueries).set({ status: 'done' }).where(eq(searchQueries.id, queryId));
      logger.log(`[GlobalSearch] ✅ Todos do cache — query marcada como done`);
    } else {
      // No results at all — also mark done
      await db.update(searchQueries).set({ status: 'done' }).where(eq(searchQueries.id, queryId));
    }

    return NextResponse.json({
      success: true,
      query: q,
      total_found: allResults.length,
      results: allResults,
      query_id: queryId,
    });
  } catch (error: unknown) {
    logger.error('[GlobalSearch] Erro interno:', error);
    return NextResponse.json(
      { success: false, error: 'Ocorreu um erro interno durante a busca global.' },
      { status: 500 }
    );
  }
}

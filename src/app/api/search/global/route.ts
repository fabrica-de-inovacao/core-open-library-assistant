import { NextResponse } from 'next/server';
import { connection } from 'next/server';
import { eq, inArray, and, or, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { OpenAlexResponseSchema } from '@/lib/schemas/openalex';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { enqueueArticleBatch } from '@/server/queue/client';

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

// ID do campo Computer Science no OpenAlex (usado como filtro secundário opcional).
const CS_FIELD_ID = '17';

// ---------------------------------------------------------------------------
// Filtros de publishers e idiomas — confirmados contra a API OpenAlex em 13/03/2026.
// Usamos host_organization_lineage para capturar todas as sub-publicações do grupo.
//
// | Publisher          | OpenAlex ID             |
// |--------------------|-------------------------|
// | IEEE (principal)   | P4310319808             |
// | IEEE (marca)       | P4322697011             |
// | ACM                | P4310319798             |
// | Springer Nature    | P4310319965             |
// | Nature Portfolio   | P4310319908             |
//
// Idiomas: en (inglês), pt (português), es (espanhol)
// ---------------------------------------------------------------------------

/** IDs OpenAlex dos publishers aceitos (IEEE, ACM, SpringerNature, Nature). */
const PUBLISHER_IDS = [
  'P4310319808', // Institute of Electrical and Electronics Engineers
  'P4322697011', // IEEE (brand)
  'P4310319798', // Association for Computing Machinery
  'P4310319965', // Springer Nature
  'P4310319908', // Nature Portfolio
];

/**
 * Filtro de publisher construído como OR (pipe) para o parâmetro filter do OpenAlex.
 * Ex: primary_location.source.host_organization_lineage:P4310319808|P4322697011|...
 */
const PUBLISHER_FILTER =
  `primary_location.source.host_organization_lineage:${PUBLISHER_IDS.join('|')}`;

/** Filtro de idioma: inglês, português, espanhol. */
const LANGUAGE_FILTER = 'language:en|pt|es';

/** OpenAlex search= usa full-text simples; booleanos aqui reduzem recall. */
function sanitizeOpenAlexSearchQuery(raw: string): string {
  return raw
    .replace(/["'()]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza a query antes de enviar ao OpenAlex.
 * Casos cobertos:
 *   - `""Termo""` (double-double-quotes nos dois lados) → `"Termo"`
 *   - `""Termo"` (aspas duplas apenas no início)          → `"Termo"`
 */
function normalizeOpenAlexQuery(raw: string): string {
  const normalized = raw
    .replace(/""([^"]+)""/g, '"$1"') // ""term"" → "term"
    .replace(/^""/, '"') // leading "" → "  (ex: ""Mermãs Digitais")
    .trim();

  return sanitizeOpenAlexSearchQuery(normalized);
}

/**
 * Gera uma query de fallback removendo termos com caracteres não-ASCII
 * (ex: "Mermãs Digitais") para ampliar o alcance quando a busca pelo nome
 * próprio não retornou resultados. Mantém apenas os termos conceituais.
 */
function buildFallbackQuery(query: string): string | null {
  // Só vale a pena se a query contém caracteres não-ASCII
  const hasNonAscii = /[^\x00-\x7F]/.test(query);
  if (!hasNonAscii) return null;

  const hasBoolean = /\b(AND|OR|NOT)\b/.test(query);
  let stripped: string;

  if (hasBoolean) {
    // Remove termos entre aspas que contêm caracteres não-ASCII (nomes próprios em Pt-BR)
    stripped = query.replace(/"[^"]*[^\x00-\x7F][^"]*"(\s+(AND|OR)\s*)?/gi, '');

    // Limpa operadores booleanos órfãos no início/fim
    stripped = stripped
      .replace(/^\s*(AND|OR)\s+/i, '')
      .replace(/\s+(AND|OR)\s*$/i, '')
      .replace(/\(\s*\)/g, '') // parênteses vazios
      .replace(/\s{2,}/g, ' ')
      .trim();
  } else {
    // Consulta simples: remove palavras que contenham caracteres não-ASCII
    // (ex: "diagnóstico" → removido; "machine learning" → mantido)
    stripped = query
      .replace(/\S*[^\x00-\x7F]\S*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return stripped && stripped !== query && stripped.length > 3 ? stripped : null;
}

/**
 * Detecta se a query contém um nome próprio (termo entre aspas) para escolher
 * a estratégia de busca mais precisa.
 * Retorna o nome próprio se encontrado, ou null.
 */
function extractProperName(query: string): string | null {
  if (/\b(AND|OR|NOT)\b/i.test(query)) return null;
  const match = query.match(/"([^"]+)"/);
  return match ? match[1] : null;
}

/** Executa uma requisição ao OpenAlex via search= e retorna os artigos mapeados. */
async function doOpenAlexFetch(
  query: string,
  extraFilters: string[], // filtros adicionais além de type:article (pode ser [])
  attempt: number,
  perPage: number = 25
): Promise<{ articles: MappedArticle[]; totalCount: number }> {
  const filters: string[] = ['type:article', PUBLISHER_FILTER, LANGUAGE_FILTER, ...extraFilters];

  const filterStr = filters.length > 0 ? `&filter=${filters.join(',')}` : '';
  const url =
    `https://api.openalex.org/works` +
    `?search=${encodeURIComponent(query)}` +
    filterStr +
    `&per-page=${perPage}` +
    `&select=${OPENALEX_SELECT}`;

  logger.debug(
    `[GlobalSearch] 🌐 OpenAlex tentativa ${attempt} | filters=[${filters.join(',')}] | query="${query.slice(0, 60)}"`
  );

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
  logger.info(
    `[GlobalSearch] ✅ Tentativa ${attempt}: ${data.results?.length ?? 0} / ${totalCount} resultados`
  );

  const articles = (data.results ?? []).map((work): MappedArticle => {
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
 * Busca artigos no OpenAlex com estratégia de até 4 tentativas progressivas.
 *
 * Problemas resolvidos:
 *   - Removído o publisher filter (ACM|IEEE|Springer) que excluía venues brasileiras
 *     (SBC, CBIE, WIE, RBIE) e pesquisas interdisciplinares.
 *   - Removído o mandatory CS field filter — temas interdisciplinares (gênero, educação,
 *     política pública) estavam completamente invisiíveis.
 *   - Para nomes próprios de projetos (ex: "Mermãs Digitais"), adiciona tentativa de
 *     busca exata por título via filter=title.search: (mais preciso que search=).
 *   - Fallback conceitual em inglês para ampliar cobertura internacional.
 *
 * Estratégia:
 *   1. search=cleanQuery, sem filtros extras        (máximo recall)
 *   2. Se tem nome próprio: filter=title.search:   (match exato no título)
 *   3. fallbackQuery sem filtros                    (conceitos sem nome próprio)
 *   4. fallbackQuery + CS field filter              (narrowing para área de TI)
 */
async function fetchOpenAlexWorks(
  query: string,
  articleLimit: number = 25
): Promise<MappedArticle[]> {
  const cleanQuery = normalizeOpenAlexQuery(query);
  logger.debug(`[GlobalSearch] Query normalizada: "${cleanQuery}"`);

  // Tentativa 1: search= sem nenhum filtro extra (máximo recall)
  const attempt1 = await doOpenAlexFetch(cleanQuery, [], 1, articleLimit);
  if (attempt1.articles.length > 0) return attempt1.articles;

  // Tentativa 2: se a query contém nome próprio entre aspas, tenta busca exata no título.
  // O endpoint search= faz relevance match — nomes de projetos locais ("Mermãs Digitais")
  // muitas vezes aparecem no título mesmo sem indexão ampla.
  const properName = extractProperName(cleanQuery);
  if (properName) {
    logger.info(`[GlobalSearch] 🔍 Tentativa 2 — busca por título exato: "${properName}"`);
    const titleFilter = [`title.search:${properName}`];
    const attempt2 = await doOpenAlexFetch(properName, titleFilter, 2, articleLimit);
    if (attempt2.articles.length > 0) return attempt2.articles;
  }

  // Tentativa 3: fallback conceitual (remove nomes próprios não-ASCII) sem filtros
  // Isso cobre temas como inclusão feminina em STEAM, que não citam "Mermãs Digitais"
  // mas são semanticamente relevantes para a pesquisa.
  const fallbackQuery = buildFallbackQuery(cleanQuery);
  if (fallbackQuery) {
    logger.info(`[GlobalSearch] 🔄 Tentativa 3 — fallback conceitual: "${fallbackQuery}"`);
    const attempt3 = await doOpenAlexFetch(fallbackQuery, [], 3, articleLimit);
    if (attempt3.articles.length > 0) return attempt3.articles;

    // Tentativa 4: fallback + filtro CS (narrowing para reduzir ruído em conceitos genéricos)
    logger.info(`[GlobalSearch] 🔄 Tentativa 4 — fallback + filtro CS`);
    const attempt4 = await doOpenAlexFetch(
      fallbackQuery,
      [`topics.field.id:${CS_FIELD_ID}`],
      4,
      articleLimit
    );
    if (attempt4.articles.length > 0) return attempt4.articles;
  }

  logger.warn(`[GlobalSearch] ⚠️ Nenhum resultado após todas as tentativas para: "${cleanQuery}"`);
  return [];
}

// ---------------------------------------------------------------------------
// GET /api/search/global?q=...&query_id=...
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // Sinaliza ao PPR que esta rota é dinâmica — deve ficar fora do try/catch
  // para que a rejeição se propague corretamente ao sistema de prerender.
  await connection();
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

    logger.info(
      `[GlobalSearch] ⚡ Nova busca global | query: "${q}" | queryId: ${queryId ?? 'novo'} | userId: ${userId ?? 'anon'}`
    );

    // 1. Create or update SearchQuery tracking record
    if (queryId) {
      await db
        .update(searchQueries)
        .set({ status: 'searching', expandedQuery: 'source:openalex', source: 'openalex', expectedCount: 0 })
        .where(eq(searchQueries.id, queryId));
      logger.debug(`[GlobalSearch] 📝 QueryID recebido → searching: ${queryId}`);
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
      logger.info(`[GlobalSearch] 📝 QueryID criado: ${queryId}`);
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
    await db
      .update(searchQueries)
      .set({ expectedCount: allResults.length, source: 'openalex' })
      .where(eq(searchQueries.id, queryId as string));
    logger.debug(
      `[GlobalSearch] 📊 Limite aplicado: ${articleLimit} | Resultados: ${allResults.length}`
    );

    // Fase C (Batch 2): paridade com SOL — poucos resultados não são suficientes para
    // revisão sistemática. Marca needs_refinement para acionar fallback automático.
    const MIN_USEFUL_ARTICLES = 5;
    if (allResults.length > 0 && allResults.length < MIN_USEFUL_ARTICLES) {
      await db
        .update(searchQueries)
        .set({ status: 'needs_refinement' })
        .where(eq(searchQueries.id, queryId));
      logger.warn(
        `[GlobalSearch] ⚠️ Apenas ${allResults.length} resultado(s) — marcando needs_refinement`
      );
      return NextResponse.json({
        success: true,
        needs_refinement: true,
        total_found: allResults.length,
        query_id: queryId,
      });
    }

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

      const knownUrls = allResults.map((r) => r.originalUrl).filter(Boolean) as string[];

      let alreadyProcessed: ExistingArticle[] = [];
      const matchConditions = [];
      if (knownDois.length > 0) matchConditions.push(inArray(articles.doi, knownDois));
      if (knownUrls.length > 0) matchConditions.push(inArray(articles.originalUrl, knownUrls));

      if (matchConditions.length > 0) {
        alreadyProcessed = (await db
          .select()
          .from(articles)
          .where(or(...matchConditions))) as ExistingArticle[];
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

      logger.info(
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
        logger.info(`[GlobalSearch] ✅ ${cachedRows.length} artigos do cache inseridos`);
      }

      // Insert fresh articles as pending (Queue worker will process them)
      if (toInsertFresh.length > 0) {
        await db
          .insert(articles)
          .values(
            toInsertFresh.map((art) => ({
              queryId: queryId,
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
          .onConflictDoUpdate({
            target: [articles.queryId, articles.originalUrl],
            set: {
              status: 'pending',
              tldrContent: null,
              updatedAt: sql`now()`,
            },
          });
        logger.info(
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
      await enqueueArticleBatch({
        query_id: queryId,
        article_ids: newArticleIds,
        user_id: userId ?? 'anonymous',
        skip_relevance_gate: true,
      });
      logger.info(
        `[GlobalSearch] 🚀 Enfileirado batch com ${newArticleIds.length} artigo(s)`
      );
    } else if (allResults.length > 0) {
      // All from cache — mark done immediately
      await db.update(searchQueries).set({ status: 'done' }).where(eq(searchQueries.id, queryId));
      logger.info(`[GlobalSearch] ✅ Todos do cache — done`);
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

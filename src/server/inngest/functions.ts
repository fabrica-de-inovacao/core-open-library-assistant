import { inngest } from './client';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray, and, notInArray, notExists, sql } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { getEmbeddingModel, getModelForTask } from '@/lib/ai-provider';
import { logger } from '@/lib/logger';
import { CrossRefResponseSchema, CrossRefSearchResponseSchema } from '@/lib/schemas/crossref';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import * as cheerio from 'cheerio';

// ─────────────────────────────────────────────────────────────────────────────
// ORQUESTRADOR: recebe o batch, executa o RelevanceGate e faz fan-out
// 1 evento por artigo → processamento paralelo real (não mais serial).
// ─────────────────────────────────────────────────────────────────────────────
export const processArticlesBatch = inngest.createFunction(
  {
    id: 'process-articles-batch',
    retries: 2,
    // Orquestrador recebe no máximo N batches simultâneos; o trabalho pesado
    // fica no processSingleArticle que tem seus próprios limites por user_id.
    concurrency: { limit: 5 },
    cancelOn: [{ event: 'app/search.cancelled', match: 'data.query_id' }],
  },
  { event: 'app/process.articles.batch' },
  async ({ event, step }) => {
    // Tipagem inferida pelo schema do cliente Inngest — sem cast manual necessário
    const { article_ids, query_id, tldr_lang, user_id } = event.data;
    logger.log(
      `\n[Inngest] 📥 Batch recebido | query_id=${query_id} | articles=${article_ids.length} | user_id=${user_id ?? 'anon'}`
    );

    // 1. Fetch articles from DB
    const pendingArticles = await step.run('fetch-articles', async () => {
      const result = await db.select().from(articles).where(inArray(articles.id, article_ids));
      // Deduplicação: pula artigos já processados em outras queries (DOI match)
      // O search/route.ts copia artigos já processados com status=done/abstract_only.
      // Inngest NÃO precisa reprocessar — eles já têm tldrContent e metadados.
      const TERMINAL = ['done', 'abstract_only'];
      const toProcess = result.filter((a) => !TERMINAL.includes(a.status ?? ''));
      if (toProcess.length < result.length) {
        logger.log(
          `[Inngest] ♻️ ${result.length - toProcess.length} artigo(s) já processados (cache) — pulando | ${toProcess.length} para processar`
        );
      } else {
        logger.log(`[Inngest] 📚 ${toProcess.length} artigo(s) para processar`);
      }
      return toProcess;
    });

    // ── Relevance Gate ────────────────────────────────────────────────────────
    // Verifica se os artigos são pertinentes ao tópico ANTES de iniciar a pipeline
    // custosa (PDF extraction, embeddings, TL;DR). Evita gastar processamento em
    // resultados irrelevantes para a pergunta do usuário.
    // NOTA: buscas globais (OpenAlex) já vêm semanticamente filtradas — pulamos o gate.
    const relevanceGate = await step.run('analyze-relevance', async () => {
      // Verifica se outro batch já marcou needs_refinement ou cancelled
      const [qData] = await db
        .select({
          status: searchQueries.status,
          originalQuery: searchQueries.originalQuery,
          expandedQuery: searchQueries.expandedQuery,
        })
        .from(searchQueries)
        .where(eq(searchQueries.id, query_id))
        .limit(1);

      if (qData?.status === 'needs_refinement' || qData?.status === 'cancelled') {
        return { proceed: false, reason: qData.status as string };
      }
      if (qData?.status === 'done') {
        return { proceed: true, reason: 'already_done' };
      }

      // OpenAlex já filtra semanticamente — não aplicar RelevanceGate
      if (qData?.expandedQuery === 'source:openalex') {
        return { proceed: true, reason: 'openalex_skip' };
      }

      const topic = qData?.originalQuery ?? '';
      // Busca todos os títulos da query (inclui artigos de outros batches simultâneos)
      const allTitles = await db
        .select({ title: articles.title })
        .from(articles)
        .where(eq(articles.queryId, query_id));

      if (allTitles.length === 0) return { proceed: true, reason: 'no_titles' };

      const titlesContext = allTitles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
      logger.log(
        `[Inngest] 🔍 Verificando relevância | query_id=${query_id} | artigos=${allTitles.length} | topic="${topic.slice(0, 60)}…"`
      );

      let analysis: { relevant: boolean; relevant_count: number; reason: string } = {
        relevant: true,
        relevant_count: allTitles.length,
        reason: '',
      };
      try {
        const { text } = await generateText({
          model: getModelForTask('tldr'),
          // Sem thinking — precisa ser rápido e não requer raciocínio complexo
          providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
          abortSignal: AbortSignal.timeout(20_000),
          system:
            'Você é um avaliador de relevância de literatura científica. Responda APENAS com JSON válido, sem markdown.',
          prompt: `Tópico de pesquisa: "${topic}"\n\nTítulos dos artigos encontrados:\n${titlesContext}\n\nEsses artigos são relevantes para o tópico acima? Responda APENAS com JSON no formato: {"relevant":true/false,"relevant_count":<n>,"reason":"<brevíssima justificativa em pt-BR>"}`,
        });
        const cleaned = text
          .trim()
          .replace(/^```json\n?/, '')
          .replace(/\n?```$/, '');
        analysis = JSON.parse(cleaned) as typeof analysis;
      } catch (err) {
        // Falha no LLM → assume relevante para não bloquear o processamento
        logger.warn(
          '[Inngest] ⚠️ Relevance check falhou — assumindo relevante:',
          (err as Error).message
        );
        return { proceed: true, reason: 'llm_error' };
      }

      logger.log(
        `[Inngest] 🔍 Relevance result | relevant=${analysis.relevant} | count=${analysis.relevant_count} | reason="${analysis.reason}"`
      );

      const MIN_RELEVANT = 3;
      if (!analysis.relevant || analysis.relevant_count < MIN_RELEVANT) {
        await db
          .update(searchQueries)
          .set({
            status: 'needs_refinement',
            summary: JSON.stringify({
              reason: analysis.reason,
              relevant_count: analysis.relevant_count,
            }),
          })
          .where(eq(searchQueries.id, query_id));
        // Marca artigos pendentes como failed para não poluir o acervo
        await db
          .update(articles)
          .set({ status: 'failed' })
          .where(and(eq(articles.queryId, query_id), eq(articles.status, 'pending')));
        logger.log(
          `[Inngest] 🚫 Artigos não relevantes — processamento cancelado | reason="${analysis.reason}"`
        );
        return { proceed: false, reason: 'not_relevant', analysis };
      }

      return { proceed: true, reason: 'ok' };
    });

    if (!relevanceGate.proceed) {
      logger.log(
        `[Inngest] ⏭️ Relevance gate: skipping processing | reason=${relevanceGate.reason}`
      );
      return { success: false, skipped: true, reason: relevanceGate.reason };
    }

    // ── Fan-out: 1 evento por artigo → processamento 100% paralelo ────────────
    if (pendingArticles.length > 0) {
      await step.sendEvent(
        'fan-out-single-articles',
        pendingArticles.map((a) => ({
          name: 'app/process.single.article' as const,
          data: {
            article_id: a.id,
            query_id,
            tldr_lang,
            user_id,
          },
        }))
      );
      logger.log(
        `[Inngest] 🚀 Fan-out: ${pendingArticles.length} evento(s) app/process.single.article disparados | query_id=${query_id}`
      );
    }

    return { success: true, dispatched: pendingArticles.length };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// WORKER POR ARTIGO: pipeline completo de um único artigo.
// Roda em paralelo com todos os outros artigos da mesma query.
// concurrency[0]: limite global no python-worker (recurso CPU compartilhado)
// concurrency[1]: limite por user_id — evita noisy-neighbor entre usuários
// ─────────────────────────────────────────────────────────────────────────────
export const processSingleArticle = inngest.createFunction(
  {
    id: 'process-single-article',
    retries: 2,
    concurrency: [
      // Máximo de requisições simultâneas ao Python worker em toda a conta
      { scope: 'account', key: '"python-worker"', limit: 5 },
      // Cada usuário processa no máximo 4 artigos ao mesmo tempo (fairness)
      { scope: 'fn', key: 'event.data.user_id', limit: 4 },
    ],
    cancelOn: [{ event: 'app/search.cancelled', match: 'data.query_id' }],
  },
  { event: 'app/process.single.article' },
  async ({ event, step }) => {
    // Tipagem inferida pelo schema do cliente Inngest — sem cast manual necessário
    const { article_id, query_id, tldr_lang } = event.data;

    // Fase 7 (P-settings): idioma dinâmico conforme preferência do usuário
    const tldrLangLabel =
      tldr_lang === 'en-US' ? 'English' : tldr_lang === 'es' ? 'Español' : 'Português do Brasil';

    // Fetch article
    const articleData = await step.run('fetch-article', async () => {
      const result = await db.select().from(articles).where(eq(articles.id, article_id)).limit(1);
      return result[0] ?? null;
    });

    if (!articleData) {
      logger.warn(`[Inngest] ⚠️ Artigo não encontrado | article_id=${article_id}`);
      return { success: false, reason: 'not_found' };
    }

    const TERMINAL = ['done', 'abstract_only', 'failed'];
    if (TERMINAL.includes(articleData.status ?? '')) {
      logger.log(
        `[Inngest] ♻️ Artigo já processado (cache) | article_id=${article_id} | status=${articleData.status}`
      );
      return { success: true, reason: 'already_processed' };
    }

    // Referência mutável para o artigo (atualizada entre steps)
    const article = { ...articleData };

    try {
      const isUserUpload =
        article.metadataSource === 'user_upload' || article.metadataSource === 'user_doi';

      // ── STEP 1: Scrape detail page ────────────────────────────────────────
      const scrapeResult = (await step.run(`scrape-detail-page-${article.id}`, async () => {
        try {
          const response = await fetchWithTimeout(
            article.originalUrl,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOLAssistant/1.0)' } },
            15_000
          );
          if (!response.ok) {
            logger.warn(`[Inngest] ⚠️ Detail page returned ${response.status} for ${article.id}`);
            return { doi: article.doi ?? null };
          }

          const html = await response.text();
          const $ = cheerio.load(html);

          const doi =
            $('meta[name="citation_doi"]').attr('content')?.trim() ||
            $('div.item.doi .value a').first().text().trim().replace('https://doi.org/', '') ||
            null;
          const rawKeywords = $('div.item.keywords .value').text().trim();
          const keywords = rawKeywords || null;
          const abstract =
            $('meta[name="DC.Description"]').attr('content')?.trim() ||
            $('div.item.abstract .value').text().trim() ||
            null;

          const updates: Record<string, string | null> = {};
          if (doi && !article.doi) updates.doi = doi;
          if (keywords) updates.keywords = keywords;
          if (abstract) updates.abstract = abstract;

          if (Object.keys(updates).length > 0) {
            await db.update(articles).set(updates).where(eq(articles.id, article.id));
          }

          logger.log(`[Inngest] ✅ Scrape OK | doi=${doi ?? 'N/A'} | article=${article.id}`);
          return { doi: doi ?? article.doi ?? null };
        } catch (err) {
          const isAbort = (err as Error).name === 'AbortError';
          logger.warn(
            `[Inngest] ⏱️ Scrape ${isAbort ? 'timeout' : 'falhou'} | article=${article.id}: ${(err as Error).message}`
          );
          return { doi: article.doi ?? null };
        }
      })) as { doi: string | null };

      // ── STEP 2: CrossRef Enrichment ───────────────────────────────────────
      if (scrapeResult?.doi) {
        await step.run(`crossref-enrich-${article.id}`, async () => {
          const doi = scrapeResult.doi!;
          try {
            const response = await fetchWithTimeout(
              `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
              { headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)' } },
              10_000
            );

            if (!response.ok) {
              logger.warn(`[Inngest] ⚠️ CrossRef HTTP ${response.status} | doi=${doi}`);
              return;
            }

            const rawData = await response.json();
            const parsed = CrossRefResponseSchema.safeParse(rawData);
            if (!parsed.success || parsed.data.status !== 'ok' || !parsed.data.message) return;

            const work = parsed.data.message;
            const abstract = work.abstract?.replace(/<\/?jats:[^>]+>/g, '')?.trim() || null;
            const keywords = [...(work.keyword ?? []), ...(work.subject ?? [])].join(', ') || null;
            const citationCount = work['is-referenced-by-count'] ?? null;

            await db
              .update(articles)
              .set({
                abstract: abstract ?? undefined,
                keywords: keywords ?? undefined,
                citationCount: citationCount ?? undefined,
                publisher: work.publisher ?? undefined,
                isOpenAccess: (work.license?.length ?? 0) > 0,
                metadataSource: 'crossref',
              })
              .where(eq(articles.id, article.id));

            logger.log(
              `[Inngest] 📊 CrossRef OK | citations=${citationCount} | article=${article.id}`
            );
          } catch (err) {
            logger.warn(
              `[Inngest] ⚠️ CrossRef falhou | article=${article.id}: ${(err as Error).message}`
            );
          }
        });
      }

      // ── STEP 2.5: Semantic Scholar — Grafo de Citações ───────────────────
      // Fase 6 (P-seguinte): busca referências (backward) e citações (forward)
      // via Semantic Scholar API (gratuita, sem chave de API).
      // Armazena JSONB em citation_graph: { references, citations, fetched_at }.
      // Rate limit sem chave: ~1 req/seg. Concurrency=4 por usuário → até 4 artigos
      // chegam ao step simultaneamente → jitter largo (0–20s) distribui os requests;
      // retries usam esperas longas (30s/60s/90s) para evitar burst sincronizado.
      if (scrapeResult?.doi && process.env.SEMANTIC_SCHOLAR_API_KEY) {
        await step.run(`semantic-scholar-graph-${article.id}`, async () => {
          const doi = scrapeResult.doi!;
          const jitterMs = Math.floor(Math.random() * 20_000); // 0–20s
          await new Promise((r) => setTimeout(r, jitterMs));

          const ssUrl =
            `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}` +
            `?fields=references.title,references.externalIds,citations.title,citations.externalIds,citations.contexts,citations.intents,tldr,authors,authors.hIndex,authors.citationCount`;

          const MAX_RETRIES = 3;
          // Waits mais curtos pois usamos API Key, 429 agora é raro e dura poucos segundos
          const RETRY_WAITS_MS = [2_000, 5_000, 10_000];
          let response: Response | null = null;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              const headers: Record<string, string> = {
                'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)',
              };
              if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
                headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
              }

              response = await fetchWithTimeout(ssUrl, { headers }, 12_000);
            } catch (fetchErr) {
              if (attempt === MAX_RETRIES) throw fetchErr;
              await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt - 1]));
              continue;
            }

            if (response.status === 429) {
              // Respeita Retry-After se presente; senão usa esperas fixas longas
              const retryAfter = response.headers.get('Retry-After');
              const waitMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : RETRY_WAITS_MS[attempt - 1]; // 30s, 60s, 90s
              logger.warn(
                `[Inngest] ⚠️ SemanticScholar 429 | doi=${doi} | tentativa=${attempt}/${MAX_RETRIES} | wait=${waitMs}ms`
              );
              if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
              }
              // Esgotou retries — falha silenciosa (não bloqueia o artigo)
              logger.warn(
                `[Inngest] ⚠️ SemanticScholar 429 esgotou retries | doi=${doi} | article=${article.id}`
              );
              return;
            }

            if (!response.ok) {
              logger.warn(
                `[Inngest] ⚠️ SemanticScholar HTTP ${response.status} | doi=${doi} | article=${article.id}`
              );
              return;
            }

            // Sucesso — sai do loop de retry
            break;
          }

          if (!response?.ok) return;

          try {
            const data = (await response.json()) as {
              references?: { title?: string; externalIds?: { DOI?: string } }[];
              citations?: {
                title?: string;
                externalIds?: { DOI?: string };
                contexts?: string[];
                intents?: string[];
              }[];
              tldr?: { text?: string };
              authors?: { name?: string; hIndex?: number; citationCount?: number }[];
            };
            const mapReference = (p: { title?: string; externalIds?: { DOI?: string } }) => ({
              title: p.title ?? null,
              doi: p.externalIds?.DOI ?? null,
            });
            const mapCitation = (p: {
              title?: string;
              externalIds?: { DOI?: string };
              contexts?: string[];
              intents?: string[];
            }) => ({
              title: p.title ?? null,
              doi: p.externalIds?.DOI ?? null,
              ...(p.contexts && p.contexts.length > 0 ? { contexts: p.contexts } : {}),
              ...(p.intents && p.intents.length > 0 ? { intents: p.intents } : {}),
            });
            const citationGraph = {
              references: (data.references ?? []).map(mapReference),
              citations: (data.citations ?? []).map(mapCitation),
              fetched_at: new Date().toISOString(),
            };

            const tldrText = data.tldr?.text?.trim() || undefined;

            const authorsStr =
              data.authors
                ?.map((a) => {
                  const parts = [a.name];
                  if (a.hIndex !== undefined) parts.push(`h-index: ${a.hIndex}`);
                  if (a.citationCount !== undefined) parts.push(`citations: ${a.citationCount}`);
                  if (parts.length > 1) {
                    return `${parts[0]} (${parts.slice(1).join(', ')})`;
                  }
                  return parts[0] || 'Unknown';
                })
                .join(', ') || undefined;

            await db
              .update(articles)
              .set({
                citationGraph,
                ...(tldrText ? { tldrContent: tldrText } : {}),
                ...(authorsStr ? { authors: authorsStr } : {}),
              })
              .where(eq(articles.id, article.id));

            logger.log(
              `[Inngest] 📚 SemanticScholar OK | refs=${citationGraph.references.length} | cites=${citationGraph.citations.length} | tldr=${!!tldrText} | article=${article.id}`
            );
          } catch (err) {
            logger.warn(
              `[Inngest] ⚠️ SemanticScholar parse falhou | article=${article.id}: ${(err as Error).message}`
            );
          }
        });
      }

      // Fase 3 (P-19): worker PyMuPDF é sempre chamado para artigos SOL.
      // O corpus SOL é LaTeX Type1/Type3 — PyMuPDF extrai 30k+ chars corretamente.
      // abstract_only é setado pelo próprio worker quando PyMuPDF + OCR falham
      // (method_used === 'abstract_scraping' no ExtractResponse do worker).
      const shouldSkipExtraction = isUserUpload;

      // ── STEP 4: PDF extraction (Python worker) ────────────────────────────
      let markdownContent = '';

      if (shouldSkipExtraction) {
        // isUserUpload: usa conteúdo já extraído pelo /extract-upload
        markdownContent = article.markdownContent ?? '';
        logger.log(
          `[Inngest] ⏭️ ${article.metadataSource} — pulando extração | article=${article.id}`
        );
      } else {
        const WORKER_BASE = process.env.PYTHON_WORKER_URL ?? 'http://127.0.0.1:8000';

        // Sinaliza 'extracting' antes de chamar o worker — preenche o gap de UX
        // entre 'pending' (na fila Inngest) e 'llm_processing' (após extração).
        // Obs: em replay do step Inngest este update é re-executado sem problema.
        await step.run(`set-extracting-${article.id}`, async () => {
          await db
            .update(articles)
            .set({ status: 'extracting' })
            .where(eq(articles.id, article.id));
        });

        const extractionResult = await step.run(`extract-pdf-${article.id}`, async () => {
          logger.log(`[Inngest] 🔄 Python Worker | article=${article.id} | worker=${WORKER_BASE}`);
          try {
            const response = await fetch(`${WORKER_BASE}/extract`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Worker-Token': process.env.WORKER_API_KEY ?? '',
              },
              body: JSON.stringify({ article_url: article.originalUrl, force_ocr: false }),
            });

            if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);

            const data = (await response.json()) as {
              success: boolean;
              content_markdown?: string;
              method_used?: string;
            };
            logger.log(
              `[Inngest] 🐍 Worker OK | method=${data.method_used} | chars=${data.content_markdown?.length ?? 0} | article=${article.id}`
            );
            return data;
          } catch (err) {
            logger.error(`[Inngest] ❌ Python Worker falhou | article=${article.id}:`, err);
            return null;
          }
        });

        if (!extractionResult || !extractionResult.success) {
          await step.run(`mark-failed-${article.id}`, async () => {
            await db.update(articles).set({ status: 'failed' }).where(eq(articles.id, article.id));
          });
          await step.run('check-and-mark-query-done-early', () => _checkAndMarkQueryDone(query_id));
          return { success: false, reason: 'worker_failed' };
        }

        markdownContent = extractionResult.content_markdown || '';
        const workerStatus =
          extractionResult.method_used === 'abstract_scraping' ? 'abstract_only' : 'llm_processing';
        const safeMarkdown = markdownContent.replace(/\x00/g, '');

        await step.run(`save-markdown-${article.id}`, async () => {
          await db
            .update(articles)
            .set({ markdownContent: safeMarkdown, status: workerStatus })
            .where(eq(articles.id, article.id));
        });
      }

      // ── STEP 4b: Inferir metadados (user_upload sem DOI) ──────────────────
      if (isUserUpload && article.metadataSource === 'user_upload' && markdownContent.length > 50) {
        // O step RETORNA o markdownContent (enriquecido ou inalterado).
        // Reatribuímos FORA do step para que o valor correto seja disponível em replay:
        // em replay, Inngest retorna o valor cacheado sem re-executar o corpo do step,
        // logo a mutação de closure seria perdida — retornar e reatribuir é a forma correta.
        const enrichedMarkdown = (await step.run(`infer-metadata-${article.id}`, async () => {
          logger.log(`[Inngest] 🔍 Inferindo metadados | article=${article.id}`);
          let md = markdownContent; // captura local — retornada modificada ou inalterada
          try {
            const sample = md.slice(0, 2500);
            const { text: extracted } = await generateText({
              model: getModelForTask('tldr'),
              abortSignal: AbortSignal.timeout(20_000),
              system:
                'Você é um extrator de metadados de artigos científicos. Retorne APENAS um JSON válido: {"title":"<titulo>","authors":"<Sobrenome A, Sobrenome B>"}',
              prompt: `Extraia título e autores:\n\n${sample}`,
            });

            let parsed: { title?: string; authors?: string } = {};
            try {
              parsed = JSON.parse(extracted.trim()) as { title?: string; authors?: string };
            } catch {
              return md;
            }

            const inferredTitle = parsed.title?.trim();
            if (!inferredTitle || inferredTitle.length < 5) return md;

            const searchUrl = new URL('https://api.crossref.org/works');
            searchUrl.searchParams.set('query.bibliographic', inferredTitle);
            if (parsed.authors?.trim())
              searchUrl.searchParams.set('query.author', parsed.authors.trim());
            searchUrl.searchParams.set('rows', '3');

            const res = await fetchWithTimeout(
              searchUrl.toString(),
              { headers: { 'User-Agent': 'SOLAssistant/1.0' } },
              12_000
            );

            type CrossRefBest = {
              score?: number;
              DOI?: string;
              title?: string[];
              author?: Array<{ given?: string; family?: string }>;
              'published-print'?: { 'date-parts'?: number[][] };
              'published-online'?: { 'date-parts'?: number[][] };
              abstract?: string;
              keyword?: string[];
              subject?: string[];
              publisher?: string;
              'container-title'?: string[];
              license?: unknown[];
            };
            let best: CrossRefBest | null = null;
            if (res.ok) {
              const raw = (await res.json()) as unknown;
              const parseResult = CrossRefSearchResponseSchema.safeParse(raw);
              if (parseResult.success) {
                best = parseResult.data.message?.items?.[0] as CrossRefBest;
              }
            }

            let doi: string | null = null;
            let finalTitle: string = inferredTitle;
            let finalAuthors: string | null = parsed.authors ?? null;
            let finalYear: number | null = null;
            let finalAbstract: string | null = null;
            let finalKeywords: string | null = null;
            let finalPublisher: string | null = null;
            let finalSourceName: string | null = null;
            let finalIsOpenAccess = false;
            let finalMetadataSource = 'scraper';
            let finalTldrText: string | null = null;

            if (best && (best.score ?? 0) >= 50) {
              doi = best.DOI ?? null;
              finalTitle = best.title?.[0] ?? inferredTitle;
              finalAuthors =
                best.author?.map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ') ??
                parsed.authors ??
                null;
              const dateArr =
                best['published-print']?.['date-parts']?.[0] ??
                best['published-online']?.['date-parts']?.[0];
              finalYear = dateArr?.[0] ?? null;
              finalAbstract = best.abstract?.replace(/<\/?jats:[^>]+>/g, '').trim() ?? null;
              finalKeywords = [...(best.keyword ?? []), ...(best.subject ?? [])].join(', ') || null;
              finalPublisher = best.publisher ?? null;
              finalSourceName = best['container-title']?.[0] ?? null;
              finalIsOpenAccess = (best.license?.length ?? 0) > 0;
              finalMetadataSource = 'crossref';
            } else if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
              // Fallback: Busca via Semantic Scholar Paper Search API
              const s2Url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
              s2Url.searchParams.set('query', inferredTitle);
              s2Url.searchParams.set(
                'fields',
                'title,authors,year,externalIds,abstract,isOpenAccess,venue,tldr,authors.hIndex,authors.citationCount'
              );
              s2Url.searchParams.set('limit', '3');

              const headers: Record<string, string> = { 'User-Agent': 'SOLAssistant/1.0' };
              if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
                headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
              }

              try {
                const s2Res = await fetchWithTimeout(s2Url.toString(), { headers }, 12_000);
                if (s2Res.ok) {
                  type S2Author = { name?: string; hIndex?: number; citationCount?: number };
                  type S2Paper = {
                    title?: string;
                    year?: number;
                    externalIds?: { DOI?: string };
                    abstract?: string;
                    venue?: string;
                    isOpenAccess?: boolean;
                    tldr?: { text?: string };
                    authors?: S2Author[];
                  };
                  const s2Data = (await s2Res.json()) as { data?: S2Paper[] };
                  const s2Best = s2Data.data?.[0];

                  if (s2Best?.title) {
                    doi = s2Best.externalIds?.DOI ?? null;
                    finalTitle = s2Best.title;
                    finalAuthors =
                      s2Best.authors
                        ?.map((a: S2Author) => {
                          const parts = [a.name];
                          if (a.hIndex !== undefined) parts.push(`h-index: ${a.hIndex}`);
                          if (a.citationCount !== undefined)
                            parts.push(`citations: ${a.citationCount}`);
                          if (parts.length > 1) {
                            return `${parts[0]} (${parts.slice(1).join(', ')})`;
                          }
                          return parts[0] || 'Unknown';
                        })
                        .join(', ') ??
                      parsed.authors ??
                      null;
                    finalYear = s2Best.year ?? null;
                    finalAbstract = s2Best.abstract ?? null;
                    finalSourceName = s2Best.venue ?? null;
                    finalIsOpenAccess = s2Best.isOpenAccess ?? false;
                    finalTldrText = s2Best.tldr?.text ?? null;
                    finalMetadataSource = 'semantic_scholar';
                  } else {
                    return md;
                  }
                } else {
                  return md;
                }
              } catch {
                return md;
              }
            }

            await db
              .update(articles)
              .set({
                title: finalTitle,
                ...(doi ? { doi } : {}),
                ...(finalAuthors ? { authors: finalAuthors } : {}),
                ...(finalYear ? { publicationYear: finalYear } : {}),
                ...(finalPublisher ? { publisher: finalPublisher } : {}),
                ...(finalSourceName ? { sourceName: finalSourceName } : {}),
                ...(finalAbstract ? { abstract: finalAbstract } : {}),
                ...(finalKeywords ? { keywords: finalKeywords } : {}),
                ...(finalTldrText ? { tldrContent: finalTldrText } : {}),
                isOpenAccess: finalIsOpenAccess,
                metadataSource: finalMetadataSource,
              })
              .where(eq(articles.id, article.id));

            // Enriquece o contexto do TL;DR com o abstract real encontrado
            if (finalAbstract) {
              md = `# ${finalTitle}\n\n**Resumo:** ${finalAbstract}\n\n---\n\n` + md;
            }
          } catch (err) {
            logger.warn(
              `[Inngest] ⚠️ Inferência metadados falhou | article=${article.id}:`,
              (err as Error).message
            );
          }
          return md; // ← sempre retorna, cacheado pelo Inngest para uso em replay
        })) as string;
        markdownContent = enrichedMarkdown; // ← reatribuição fora do step = correto em replay
      }

      // ── STEP 5: Gerar TL;DR ───────────────────────────────────────────────
      const tldr = await step.run(`generate-tldr-${article.id}`, async () => {
        const [enriched] = await db
          .select({
            keywords: articles.keywords,
            abstract: articles.abstract,
            tldrContent: articles.tldrContent,
          })
          .from(articles)
          .where(eq(articles.id, article.id));

        // Fase 1: S2 TL;DR Native Integration
        if (enriched?.tldrContent && enriched.tldrContent.length > 10) {
          logger.log(`[Inngest] ⚡ TL;DR nativo via Semantic Scholar | article=${article.id}`);
          return enriched.tldrContent;
        }

        const contextPrefix = [
          enriched?.keywords ? `Palavras-chave oficiais: ${enriched.keywords}` : '',
          enriched?.abstract ? `Resumo do autor: ${enriched.abstract.substring(0, 500)}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        try {
          const { text } = await generateText({
            model: getModelForTask('tldr'),
            abortSignal: AbortSignal.timeout(45_000),
            system: `Você é um assistente acadêmico especializado em sínteses científicas. Crie uma síntese estruturada EXATAMENTE neste formato:
\uD83D\uDD0D Problema: [qual problema o artigo endereça, em 1 frase]
\uD83D\uDEE0 Método: [abordagem ou metodologia principal, em 1 frase]
✅ Resultado: [principal conclusão ou contribuição, em 1 frase]
REGRAS: Máximo 600 caracteres. Obrigatoriamente em ${tldrLangLabel}. Sem texto fora do template.
FALLBACK: Se o conteúdo do artigo fornecido for fragmentado, corrompido ou ilegível (ex: PDF escaneado), baseie-se apenas no campo "Resumo do autor" fornecido acima. Se ambos forem indisponíveis, indique "Não foi possível gerar síntese" no campo Resultado.`,
            prompt: `${contextPrefix ? contextPrefix + '\n\n' : ''}Gere a síntese:\n\n${markdownContent.substring(0, 30000)}`,
          });
          logger.log(`[Inngest] ✅ TL;DR OK | ${text.length} chars | article=${article.id}`);
          return text;
        } catch (err) {
          logger.error(`[Inngest] ❌ LLM TL;DR falhou | article=${article.id}:`, err);
          return null;
        }
      });

      // ── STEP 5.5: Embedding — gerado APÓS TL;DR para usar o conteúdo mais rico ──
      // TL;DR sintético (600 chars estruturados) > abstract para matching semântico.
      await step.run(`embed-content-${article.id}`, async () => {
        const text = (tldr ?? article.abstract) || null;
        if (!text) return;
        try {
          const { embedding } = await embed({
            model: getEmbeddingModel(),
            value: text.slice(0, 2000),
            // gemini-embedding-001 usa MRL (padrão 3072 dims) — truncamos para 768
            // para ser compatível com a coluna vector(768) no Supabase.
            providerOptions: { google: { outputDimensionality: 768 } },
          });
          await db
            .update(articles)
            .set({ abstractEmbedding: embedding })
            .where(eq(articles.id, article.id));
          logger.log(
            `[Inngest] 🧮 Embedding OK | dims=${embedding.length} | article=${article.id}`
          );
        } catch (err) {
          logger.warn(
            `[Inngest] ⚠️ Embedding falhou | article=${article.id}: ${(err as Error).message}`
          );
        }
      });

      // ── STEP 6: Salvar TL;DR e verificar conclusão da query ──────────────
      await step.run(`save-tldr-${article.id}`, async () => {
        await db
          .update(articles)
          .set({
            tldrContent: tldr || 'Falha ao gerar síntese via IA.',
            status: tldr ? 'done' : 'failed',
          })
          .where(eq(articles.id, article.id));
      });
    } catch (articleErr) {
      logger.error(`[Inngest] ❌ Erro inesperado | article=${article.id}:`, articleErr);
      await step.run(`mark-failed-unexpected-${article.id}`, async () => {
        await db.update(articles).set({ status: 'failed' }).where(eq(articles.id, article.id));
      });
    }

    // Cada artigo verifica ao terminar se é o último → marca query como done.
    // Dentro de step.run para garantir retry em caso de falha de DB.
    await step.run('check-and-mark-query-done', () => _checkAndMarkQueryDone(query_id));

    return { success: true, article_id };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: verifica atomicamente se todos os artigos da query terminaram
// e marca a query como 'done' se sim.
//
// Usa um UPDATE atômico com subquery ao invés do padrão SELECT → check → UPDATE,
// eliminando a race condition TOCTOU que ocorre quando múltiplos workers de
// artigos diferentes terminam ao mesmo tempo (o objetivo exato do fan-out).
//
// O UPDATE só atualiza se:
//   1. A query ainda não está em estado terminal (done/cancelled/needs_refinement)
//   2. Não existe nenhum artigo ainda pendente (status fora de TERMINAL)
// ─────────────────────────────────────────────────────────────────────────────
async function _checkAndMarkQueryDone(query_id: string): Promise<void> {
  // UPDATE atômico: marca done só se (a) query ainda não está em estado terminal
  // E (b) não há nenhum artigo pendente.
  // O WHERE com NOT EXISTS prevêne race condition TOCTOU quando múltiplos
  // workers terminam simultaneamente — cada UPDATE opera atomicamente no Postgres.
  const updated = await db
    .update(searchQueries)
    .set({ status: 'done' })
    .where(
      and(
        eq(searchQueries.id, query_id),
        notInArray(searchQueries.status, ['done', 'cancelled', 'needs_refinement']),
        notExists(
          db
            .select({ _: sql`1` })
            .from(articles)
            .where(
              and(
                eq(articles.queryId, query_id),
                notInArray(articles.status, ['done', 'abstract_only', 'failed'])
              )
            )
        )
      )
    )
    .returning({ id: searchQueries.id });

  if (updated.length > 0) {
    logger.log(`[Inngest] ✅ Query marcada como done (atômico) | query_id=${query_id}`);
  } else {
    logger.log(`[Inngest] ⏳ Pending ou já finalizada — nenhuma ação | query_id=${query_id}`);
  }
}

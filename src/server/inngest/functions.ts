import { inngest } from './client';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import {
  getEmbeddingModel,
  getLanguageModel,
  getModelForTask,
  getModelIdForTask,
} from '@/lib/ai-provider';
import { logger } from '@/lib/logger';
import { CrossRefResponseSchema } from '@/lib/schemas/crossref';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
dotenv.config();

export const processArticlesBatch = inngest.createFunction(
  {
    id: 'process-articles-batch',
    // E-01: retry automático em falhas transitórias (rede, LLM 5xx)
    retries: 2,
    concurrency: { limit: 3 },
  },
  { event: 'app/process.articles.batch' },
  async ({ event, step }) => {
    const { article_ids, query_id } = event.data;
    logger.log(
      `\n[Inngest] 📥 Evento recebido: app/process.articles.batch | query_id=${query_id} | article_ids=${JSON.stringify(article_ids)}`
    );

    // 1. Fetch articles from DB
    const pendingArticles = await step.run('fetch-articles', async () => {
      const result = await db.select().from(articles).where(inArray(articles.id, article_ids));
      logger.log(`[Inngest] 📚 ${result.length} artigo(s) buscados do DB para processar`);
      return result;
    });

    for (const article of pendingArticles) {
      // E-03: isolação por artigo — falha em 1 não cancela o batch inteiro
      try {
        const scrapeResult = (await step.run(`scrape-detail-page-${article.id}`, async () => {
          // ── STEP 1: Scrape article detail page for DOI + Keywords ──
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            const response = await fetch(article.originalUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOLAssistant/1.0)' },
              signal: controller.signal,
            }).finally(() => clearTimeout(timeout));

            if (!response.ok) {
              logger.warn(`[Inngest] ⚠️ Detail page returned ${response.status} for ${article.id}`);
              return;
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            // DOI: best from <meta name="citation_doi"> or div.item.doi a
            const doi =
              $('meta[name="citation_doi"]').attr('content')?.trim() ||
              $('div.item.doi .value a').first().text().trim().replace('https://doi.org/', '') ||
              null;

            // Keywords: div.item.keywords .value text (comma-separated)
            const rawKeywords = $('div.item.keywords .value').text().trim();
            const keywords = rawKeywords || null;

            // Abstract: try meta[name="DC.Description"] first, then div.item.abstract .value
            const abstract =
              $('meta[name="DC.Description"]').attr('content')?.trim() ||
              $('div.item.abstract .value').text().trim() ||
              null;

            logger.log(
              `[Inngest] ✅ Detail scrape OK | doi=${doi ?? 'N/A'} | keywords_found=${!!keywords} | abstract_found=${!!abstract}`
            );

            // Only update if we found something new
            const updates: Record<string, string | null> = {};
            if (doi && !article.doi) updates.doi = doi;
            if (keywords) updates.keywords = keywords;
            if (abstract) updates.abstract = abstract;

            if (Object.keys(updates).length > 0) {
              await db.update(articles).set(updates).where(eq(articles.id, article.id));
            }

            // Return doi so next step can use it
            return { doi: doi ?? article.doi ?? null };
          } catch (err) {
            const isAbort = (err as Error).name === 'AbortError';
            logger.warn(
              `[Inngest] ⏱️ Detail scrape ${isAbort ? 'timeout' : 'falhou'} para ${article.id}: ${(err as Error).message}`
            );
            return { doi: article.doi ?? null };
          }
        })) as { doi: string | null };

        // ── NEW STEP 2: CrossRef Enrichment ──
        if (scrapeResult?.doi) {
          await step.run(`crossref-enrich-${article.id}`, async () => {
            const doi = scrapeResult.doi!;
            logger.log(`[Inngest] 🌐 CrossRef lookup for doi=${doi}`);
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10_000);
              const response = await fetch(
                `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
                {
                  headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)' },
                  signal: controller.signal,
                }
              ).finally(() => clearTimeout(timeout));

              if (!response.ok) {
                logger.warn(`[Inngest] ⚠️ CrossRef returned ${response.status} for doi=${doi}`);
                return;
              }

              const rawData = await response.json();
              const parsed = CrossRefResponseSchema.safeParse(rawData);
              if (!parsed.success) {
                logger.warn(
                  `[Inngest] ⚠️ CrossRef response schema inválido para doi=${doi}:`,
                  parsed.error.issues
                );
                return;
              }
              const data = parsed.data;
              if (data.status !== 'ok' || !data.message) return;

              const work = data.message;
              const abstract = work.abstract?.replace(/<\/?jats:[^>]+>/g, '')?.trim() || null;
              const keywords =
                [...(work.keyword ?? []), ...(work.subject ?? [])].join(', ') || null;
              const citationCount = work['is-referenced-by-count'] ?? null;
              const publisher = work.publisher ?? null;
              const isOpenAccess = (work.license?.length ?? 0) > 0;

              logger.log(
                `[Inngest] 📊 CrossRef OK | citations=${citationCount} | keywords_found=${!!keywords}`
              );
              await db
                .update(articles)
                .set({
                  abstract: abstract ?? undefined,
                  keywords: keywords ?? undefined,
                  citationCount: citationCount ?? undefined,
                  publisher: publisher ?? undefined,
                  isOpenAccess,
                  metadataSource: 'crossref',
                })
                .where(eq(articles.id, article.id));
            } catch (err) {
              const isAbort = (err as Error).name === 'AbortError';
              logger.warn(
                `[Inngest] ⏱️ CrossRef ${isAbort ? 'timeout' : 'falhou'} para doi=${doi}: ${(err as Error).message}`
              );
            }
          });
        }

        // ── STEP 3: Compute abstract embedding for semantic reranking ──
        await step.run(`embed-abstract-${article.id}`, async () => {
          // Re-fetch the latest abstract (may have been enriched by CrossRef above)
          const [fresh] = await db
            .select({ abstract: articles.abstract, tldrContent: articles.tldrContent })
            .from(articles)
            .where(eq(articles.id, article.id));

          const text = fresh?.abstract ?? fresh?.tldrContent;
          if (!text) {
            logger.log(`[Inngest] ⏭️  Sem abstract para embedding | article=${article.id}`);
            return;
          }

          try {
            const { embedding } = await embed({
              model: getEmbeddingModel(),
              value: text.slice(0, 2000), // cap para controle de custo
            });
            await db
              .update(articles)
              .set({ abstractEmbedding: JSON.stringify(embedding) })
              .where(eq(articles.id, article.id));
            logger.log(
              `[Inngest] 🧮 Embedding computado | article=${article.id} | dims=${embedding.length}`
            );
          } catch (err) {
            // Embedding não é crítico — falha silenciosa para não bloquear o pipeline
            logger.warn(
              `[Inngest] ⚠️  Embedding falhou para article=${article.id}:`,
              (err as Error).message
            );
          }
        });

        // E-05: rejeitar PDFs acima de 20 MB antes de invocar o worker
        const PDF_SIZE_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB
        if (article.originalUrl) {
          try {
            const headRes = await fetch(article.originalUrl, { method: 'HEAD' });
            const contentLength = parseInt(headRes.headers.get('content-length') ?? '0', 10);
            if (contentLength > PDF_SIZE_LIMIT_BYTES) {
              logger.warn(
                `[Inngest] ⚠️ PDF muito grande (${Math.round(contentLength / 1024 / 1024)}MB), pulando extração | article=${article.id}`
              );
              await step.run(`mark-abstract-only-${article.id}`, async () => {
                await db
                  .update(articles)
                  .set({ status: 'abstract_only' })
                  .where(eq(articles.id, article.id));
              });
              continue;
            }
          } catch {
            // HEAD falhou — continua e deixa o worker decidir
          }
        }

        // 2. Call Python Worker for PDF extraction
        // A-03: URL via env var (PYTHON_WORKER_URL), fallback para localhost em dev
        const WORKER_BASE = process.env.PYTHON_WORKER_URL ?? 'http://127.0.0.1:8000';
        const extractionResult = await step.run(`extract-pdf-${article.id}`, async () => {
          logger.log(
            `[Inngest] 🔄 Chamando Python Worker | article=${article.id} | worker=${WORKER_BASE}`
          );
          try {
            const response = await fetch(`${WORKER_BASE}/extract`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // F-01: nunca usar chave hardcoded; se env não estiver configurada, header vai vazio
                'X-Worker-Token': process.env.WORKER_API_KEY ?? '',
              },
              body: JSON.stringify({
                article_url: article.originalUrl,
                force_ocr: false,
              }),
            });

            if (!response.ok) {
              throw new Error(`Worker returned ${response.status}`);
            }
            const data = (await response.json()) as {
              success: boolean;
              content_markdown?: string;
              method_used?: string;
            };
            logger.log(
              `[Inngest] 🐍 Worker OK | article=${article.id} | method=${data.method_used} | chars=${data.content_markdown?.length ?? 0}`
            );
            return data;
          } catch (error: unknown) {
            logger.error(`[Inngest] ❌ Python Worker falhou para article=${article.id}:`, error);
            return null;
          }
        });

        if (!extractionResult || !extractionResult.success) {
          await step.run(`mark-failed-${article.id}`, async () => {
            await db.update(articles).set({ status: 'failed' }).where(eq(articles.id, article.id));
          });
          continue;
        }

        const markdownContent = extractionResult.content_markdown || '';
        const workerStatus =
          extractionResult.method_used === 'abstract_scraping' ? 'abstract_only' : 'llm_processing';

        // Update to processing state with markdown
        await step.run(`save-markdown-${article.id}`, async () => {
          await db
            .update(articles)
            .set({
              markdownContent: markdownContent,
              status: workerStatus,
            })
            .where(eq(articles.id, article.id));
        });

        // 3. Generate TL;DR via LLM using enriched context
        const tldr = await step.run(`generate-tldr-${article.id}`, async () => {
          // Re-fetch to include any enriched metadata for context
          const [enrichedArticle] = await db
            .select({ keywords: articles.keywords, abstract: articles.abstract })
            .from(articles)
            .where(eq(articles.id, article.id));

          const contextPrefix = [
            enrichedArticle?.keywords ? `Palavras-chave oficiais: ${enrichedArticle.keywords}` : '',
            enrichedArticle?.abstract
              ? `Resumo do autor: ${enrichedArticle.abstract.substring(0, 500)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n');

          logger.log(
            `[Inngest] 🤖 Gerando TL;DR via LLM para article=${article.id} | provider=${process.env.LLM_PROVIDER ?? 'google'} | model=${getModelIdForTask('tldr')}`
          );
          try {
            const { text } = await generateText({
              model: getModelForTask('tldr'),
              // E-02: timeout de 45s para evitar que o step fique pendurado indefinidamente
              abortSignal: AbortSignal.timeout(45_000),
              system: `Você é um assistente acadêmico especializado em sínteses científicas. Leia o texto fornecido e crie uma síntese estruturada EXATAMENTE no seguinte formato de 3 linhas:
🔍 Problema: [qual problema ou lacuna o artigo endereça, em 1 frase]
🛠 Método: [abordagem, técnica ou metodologia principal utilizada, em 1 frase]
✅ Resultado: [principal conclusão ou contribuição do trabalho, em 1 frase]
REGRAS: Máximo 600 caracteres no total. Obrigatoriamente em Português do Brasil. Sem saudações. Sem texto fora do template acima. Se o conteúdo for insuficiente, use o abstract disponível.`,
              prompt: `${contextPrefix ? contextPrefix + '\n\n' : ''}Gere a síntese estruturada do seguinte texto científico:\n\n${markdownContent.substring(0, 30000)}`,
            });
            logger.log(
              `[Inngest] ✅ TL;DR gerado para article=${article.id} | ${text.length} chars`
            );
            return text;
          } catch (error: unknown) {
            logger.error(`[Inngest] ❌ LLM falhou para article=${article.id}:`, error);
            return null;
          }
        });

        // 4. Final DB update
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
        // E-03: garante que o artigo seja marcado como 'failed' mesmo com erro inesperado
        logger.error(
          `[Inngest] ❌ Erro inesperado no processamento de article=${article.id}:`,
          articleErr
        );
        await step.run(`mark-failed-unexpected-${article.id}`, async () => {
          await db.update(articles).set({ status: 'failed' }).where(eq(articles.id, article.id));
        });
      }
    } // fim for (const article of pendingArticles)

    // Wait for other concurrent batches to finish before checking global completion.
    await step.sleep('wait-for-concurrent-batches', '8s');

    // Final step: only mark query as 'done' if ALL articles for this query are in a terminal state.
    await step.run('mark-query-done', async () => {
      const TERMINAL = ['done', 'abstract_only', 'failed'];
      const allArticles = await db
        .select({ id: articles.id, status: articles.status })
        .from(articles)
        .where(eq(articles.queryId, query_id));

      const allFinished = allArticles.every((a) => TERMINAL.includes(a.status ?? ''));
      const doneCount = allArticles.filter((a) => a.status !== 'failed').length;

      logger.log(
        `[Inngest] 🏁 Batch concluído | query_id=${query_id} | total_artigos=${allArticles.length} | terminais=${allArticles.filter((a) => TERMINAL.includes(a.status ?? '')).length} | todos_prontos=${allFinished}`
      );

      if (allFinished) {
        logger.log(
          `[Inngest] ✅ Todos os artigos terminados. Marcando query como 'done' | ok=${doneCount} | falhas=${allArticles.length - doneCount}`
        );
        await db
          .update(searchQueries)
          .set({ status: 'done' })
          .where(eq(searchQueries.id, query_id));
      } else {
        const stillPending = allArticles.filter((a) => !TERMINAL.includes(a.status ?? '')).length;
        logger.log(
          `[Inngest] ⏳ ${stillPending} artigo(s) ainda pendentes em outros batches — não marcando query como done ainda.`
        );
      }
    });

    return { success: true, processed: pendingArticles.length };
  }
);

import { inngest } from './client';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai-provider';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
dotenv.config();

// --- CrossRef API Types ---
interface CrossRefWork {
  title?: string[];
  abstract?: string;
  subject?: string[];
  keyword?: string[];
  'is-referenced-by-count'?: number;
  publisher?: string;
  license?: { URL: string }[];
}
interface CrossRefResponse {
  status: string;
  message?: CrossRefWork;
}

export const processArticlesBatch = inngest.createFunction(
  { id: 'process-articles-batch', concurrency: { limit: 3 } },
  { event: 'app/process.articles.batch' },
  async ({ event, step }) => {
    const { article_ids, query_id } = event.data;
    console.log(
      `\n[Inngest] 📥 Evento recebido: app/process.articles.batch | query_id=${query_id} | article_ids=${JSON.stringify(article_ids)}`
    );

    // 1. Fetch articles from DB
    const pendingArticles = await step.run('fetch-articles', async () => {
      const result = await db.select().from(articles).where(inArray(articles.id, article_ids));
      console.log(`[Inngest] 📚 ${result.length} artigo(s) buscados do DB para processar`);
      return result;
    });

    for (const article of pendingArticles) {
      // ── NEW STEP 1: Scrape article detail page for DOI + Keywords ──
      const scrapeResult = (await step.run(`scrape-detail-page-${article.id}`, async () => {
        console.log(`[Inngest] 🔍 Scraping detail page: ${article.originalUrl}`);
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const response = await fetch(article.originalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOLAssistant/1.0)' },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));

          if (!response.ok) {
            console.warn(`[Inngest] ⚠️ Detail page returned ${response.status} for ${article.id}`);
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

          console.log(
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
          console.warn(
            `[Inngest] ⏱️ Detail scrape ${isAbort ? 'timeout' : 'falhou'} para ${article.id}: ${(err as Error).message}`
          );
          return { doi: article.doi ?? null };
        }
      })) as { doi: string | null };

      // ── NEW STEP 2: CrossRef Enrichment ──
      if (scrapeResult?.doi) {
        await step.run(`crossref-enrich-${article.id}`, async () => {
          const doi = scrapeResult.doi!;
          console.log(`[Inngest] 🌐 CrossRef lookup for doi=${doi}`);
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
              console.warn(`[Inngest] ⚠️ CrossRef returned ${response.status} for doi=${doi}`);
              return;
            }

            const data = (await response.json()) as CrossRefResponse;
            if (data.status !== 'ok' || !data.message) return;

            const work = data.message;
            const abstract = work.abstract?.replace(/<\/?jats:[^>]+>/g, '')?.trim() || null;
            const keywords = [...(work.keyword ?? []), ...(work.subject ?? [])].join(', ') || null;
            const citationCount = work['is-referenced-by-count'] ?? null;
            const publisher = work.publisher ?? null;
            const isOpenAccess = (work.license?.length ?? 0) > 0;

            console.log(
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
            console.warn(
              `[Inngest] ⏱️ CrossRef ${isAbort ? 'timeout' : 'falhou'} para doi=${doi}: ${(err as Error).message}`
            );
          }
        });
      }

      // 2. Call Python Worker for PDF extraction
      const extractionResult = await step.run(`extract-pdf-${article.id}`, async () => {
        console.log(
          `[Inngest] 🔄 Chamando Python Worker para artigo ${article.id} | URL: ${article.originalUrl}`
        );
        try {
          const response = await fetch('http://127.0.0.1:8000/extract', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Worker-Token': process.env.WORKER_API_KEY || 'your_secret_worker_key_here',
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
          console.log(
            `[Inngest] 🐍 Worker OK | article=${article.id} | method=${data.method_used} | chars=${data.content_markdown?.length ?? 0}`
          );
          return data;
        } catch (error: unknown) {
          console.error(`[Inngest] ❌ Python Worker falhou para article=${article.id}:`, error);
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

        console.log(
          `[Inngest] 🤖 Gerando TL;DR via LLM para article=${article.id} | provider=${process.env.LLM_PROVIDER ?? 'google'} | model=${process.env.LLM_MODEL ?? 'default'}`
        );
        try {
          const { text } = await generateText({
            model: getLanguageModel(),
            system: `Você é um assistente acadêmico. Leia o texto fornecido (em formato Markdown) e elabore uma síntese extremamente concisa, focando no Problema resolvido, Metodologia e Conclusão. O seu resumo deve ter no MÁXIMO 300 caracteres e deve OBRIGATORIAMENTE ser redigido em Português do Brasil, independentemente do idioma original do texto. Se o texto não contiver informações suficientes, faça o melhor resumo possível com o conteúdo disponibilizado. Não inclua saudações.`,
            prompt: `${contextPrefix ? contextPrefix + '\n\n' : ''}Resuma o seguinte texto científico:\n\n${markdownContent.substring(0, 30000)}`,
          });
          console.log(
            `[Inngest] ✅ TL;DR gerado para article=${article.id} | ${text.length} chars`
          );
          return text;
        } catch (error: unknown) {
          console.error(`[Inngest] ❌ LLM falhou para article=${article.id}:`, error);
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
    }

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

      console.log(
        `[Inngest] 🏁 Batch concluído | query_id=${query_id} | total_artigos=${allArticles.length} | terminais=${allArticles.filter((a) => TERMINAL.includes(a.status ?? '')).length} | todos_prontos=${allFinished}`
      );

      if (allFinished) {
        console.log(
          `[Inngest] ✅ Todos os artigos terminados. Marcando query como 'done' | ok=${doneCount} | falhas=${allArticles.length - doneCount}`
        );
        await db
          .update(searchQueries)
          .set({ status: 'done' })
          .where(eq(searchQueries.id, query_id));
      } else {
        const stillPending = allArticles.filter((a) => !TERMINAL.includes(a.status ?? '')).length;
        console.log(
          `[Inngest] ⏳ ${stillPending} artigo(s) ainda pendentes em outros batches — não marcando query como done ainda.`
        );
      }
    });

    return { success: true, processed: pendingArticles.length };
  }
);

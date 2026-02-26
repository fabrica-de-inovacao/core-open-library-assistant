import { inngest } from './client';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai-provider';
import * as dotenv from 'dotenv';
dotenv.config();

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
      // 2. Call Python Worker
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

      // 3. Generate TL;DR via LLM
      const tldr = await step.run(`generate-tldr-${article.id}`, async () => {
        console.log(
          `[Inngest] 🤖 Gerando TL;DR via LLM para article=${article.id} | provider=${process.env.LLM_PROVIDER ?? 'google'} | model=${process.env.LLM_MODEL ?? 'default'}`
        );
        try {
          const { text } = await generateText({
            model: getLanguageModel(),
            system: `Você é um assistente acadêmico. Leia o texto fornecido (em formato Markdown) e elabore uma síntese extremamente concisa, focando no Problema resolvido, Metodologia e Conclusão. O seu resumo deve ter no MÁXIMO 300 caracteres e deve OBRIGATORIAMENTE ser redigido em Português do Brasil, independentemente do idioma original do texto. Se o texto não contiver informações suficientes, faça o melhor resumo possível com o conteúdo disponibilizado. Não inclua saudações.`,
            prompt: `Resuma o seguinte texto científico:\n\n${markdownContent.substring(0, 30000)}`,
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
    // With concurrency:3, multiple batches run in parallel. Without a delay, they all
    // query article statuses at the same time and none sees a fully-completed set.
    await step.sleep('wait-for-concurrent-batches', '8s');

    // Final step: only mark query as 'done' if ALL articles for this query are in a terminal state.
    // With fan-out (multiple batches), each batch runs independently — we must check the full set.
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

import { Worker, type Job } from 'bullmq';
import { generateText } from 'ai';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { bullmqRedis } from '@/lib/redis';
import { getModelForTask } from '@/lib/ai-provider';
import { getUserModel } from '@/server/llm/client';
import { logger } from '@/lib/logger';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import type { ArticleOrchestrationJob } from './jobs';
import { publishQueryStatus } from './notifier';

async function runRelevanceGate(queryId: string, skipRelevanceGate?: boolean, userId?: string | null) {
  if (skipRelevanceGate) return { proceed: true, reason: 'openalex_skip' };

  const [qData] = await db
    .select({ originalQuery: searchQueries.originalQuery, expandedQuery: searchQueries.expandedQuery })
    .from(searchQueries)
    .where(eq(searchQueries.id, queryId))
    .limit(1);

  if (qData?.expandedQuery === 'source:openalex') return { proceed: true, reason: 'openalex_skip' };

  const topic = qData?.originalQuery ?? '';
  const allTitles = await db
    .select({ title: articles.title })
    .from(articles)
    .where(eq(articles.queryId, queryId));

  if (allTitles.length === 0) return { proceed: true, reason: 'no_titles' };

  const titlesContext = allTitles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
  let analysis: { relevant: boolean; relevant_count: number; reason: string } = {
    relevant: true,
    relevant_count: allTitles.length,
    reason: '',
  };

  try {
    const { text } = await generateText({
      model: userId ? await getUserModel(userId, 'tldr') : getModelForTask('tldr'),
      abortSignal: AbortSignal.timeout(20_000),
      system:
        'Você é um avaliador de relevância de literatura científica. Responda APENAS com JSON válido, sem markdown.',
      prompt: `Tópico de pesquisa: "${topic}"\n\nTítulos dos artigos encontrados:\n${titlesContext}\n\nEsses artigos são relevantes para o tópico acima? Responda APENAS com JSON no formato: {"relevant":true/false,"relevant_count":<n>,"reason":"<brevíssima justificativa em pt-BR>"}`,
    });
    analysis = JSON.parse(text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')) as typeof analysis;
  } catch (err) {
    logger.warn('[BullMQ] Relevance check falhou, assumindo relevante:', (err as Error).message);
    return { proceed: true, reason: 'llm_error' };
  }

  if (!analysis.relevant || analysis.relevant_count < 3) {
    await db
      .update(searchQueries)
      .set({ status: 'needs_refinement', summary: JSON.stringify(analysis) })
      .where(eq(searchQueries.id, queryId));
    await db
      .update(articles)
      .set({ status: 'failed' })
      .where(and(eq(articles.queryId, queryId), eq(articles.status, 'pending')));
    await publishQueryStatus({ query_id: queryId, status: 'needs_refinement' });
    return { proceed: false, reason: 'not_relevant' };
  }

  return { proceed: true, reason: 'ok' };
}

async function enqueuePythonArticleJobs(job: ArticleOrchestrationJob) {
  const workerUrl = process.env.PYTHON_WORKER_URL;
  const workerApiKey = process.env.WORKER_API_KEY;

  if (!workerUrl || !workerApiKey) {
    throw new Error('PYTHON_WORKER_URL e WORKER_API_KEY são obrigatórios para enfileirar artigos.');
  }

  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/jobs/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Token': workerApiKey,
    },
    body: JSON.stringify({
      article_ids: job.article_ids,
      query_id: job.query_id,
      user_id: job.user_id,
      tldr_lang: job.tldr_lang ?? 'pt-BR',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Python worker enqueue falhou (${response.status}): ${body.slice(0, 300)}`);
  }

  return response.json() as Promise<{ success: boolean; enqueued: number; job_ids: string[] }>;
}

export function startOrchestratorWorker() {
  const worker = new Worker<ArticleOrchestrationJob>(
    'core.article.orchestrate',
    async (job: Job<ArticleOrchestrationJob>) => {
      const { article_ids, query_id, user_id, skip_relevance_gate } = job.data;
      const relevanceGate = await runRelevanceGate(query_id, skip_relevance_gate, user_id);

      if (!relevanceGate.proceed) return { success: false, skipped: true };

      const result = await enqueuePythonArticleJobs(job.data);

      logger.info(`[BullMQ] Fan-out arq: ${result.enqueued} artigo(s) | query_id=${query_id}`);
      return { success: true, dispatched: result.enqueued };
    },
    { connection: bullmqRedis, concurrency: 5 }
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error('[BullMQ] Orquestrador falhou:', err);
    await db
      .update(articles)
      .set({ status: 'failed' })
      .where(
        and(
          eq(articles.queryId, job.data.query_id),
          notInArray(articles.status, ['done', 'abstract_only', 'failed'])
        )
      );
    await db
      .update(searchQueries)
      .set({ status: 'needs_refinement' })
      .where(eq(searchQueries.id, job.data.query_id));
    await publishQueryStatus({ query_id: job.data.query_id, status: 'needs_refinement' });
  });

  return worker;
}

import { Queue } from 'bullmq';
import { bullmqRedis } from '@/lib/redis';
import type { ArticleOrchestrationJob } from './jobs';

export const orchestratorQueue = new Queue<ArticleOrchestrationJob>('core.article.orchestrate', {
  connection: bullmqRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  },
});

export async function enqueueArticleBatch(job: ArticleOrchestrationJob) {
  await orchestratorQueue.add('orchestrate', job);

  // Enfileira os artigos individualmente no Redis para o worker Python consumir
  await Promise.all(
    job.article_ids.map((articleId) =>
      bullmqRedis.lpush(
        'core:article.process.pending',
        JSON.stringify({ ...job, article_id: articleId })
      )
    )
  );
}

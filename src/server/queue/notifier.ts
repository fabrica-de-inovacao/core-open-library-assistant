import { bullmqRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';

type ArticleUpdate = {
  type: 'article.updated';
  article_id: string;
  status?: string;
  tldr_content?: string | null;
};

type QueryStatusUpdate = {
  type: 'query.status';
  query_id: string;
  status: string;
};

export async function publishArticleUpdate(queryId: string, update: Omit<ArticleUpdate, 'type'>) {
  try {
    await bullmqRedis.publish(`query:${queryId}`, JSON.stringify({ type: 'article.updated', ...update }));
  } catch (err) {
    logger.warn('[Redis] Falha ao publicar article.updated:', (err as Error).message);
  }
}

export async function publishQueryStatus(update: Omit<QueryStatusUpdate, 'type'>) {
  try {
    await bullmqRedis.publish(`query:${update.query_id}`, JSON.stringify({ type: 'query.status', ...update }));
  } catch (err) {
    logger.warn('[Redis] Falha ao publicar query.status:', (err as Error).message);
  }
}

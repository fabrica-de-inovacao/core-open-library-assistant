import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { searchQueries, articles } from '@/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { bullmqRedis } from '@/lib/redis';
import { orchestratorQueue } from '@/server/queue/client';
import { logger } from '@/lib/logger';
import { publishQueryStatus } from '@/server/queue/notifier';

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const { query_id } = await request.json();
  if (!query_id || typeof query_id !== 'string') {
    return NextResponse.json({ success: false, error: 'query_id obrigatório.' }, { status: 400 });
  }

  // Verifica se a query existe e pertence ao utilizador (se autenticado)
  const [query] = await db
    .select({ id: searchQueries.id, userId: searchQueries.userId, status: searchQueries.status })
    .from(searchQueries)
    .where(eq(searchQueries.id, query_id))
    .limit(1);

  if (!query) {
    return NextResponse.json({ success: false, error: 'Query não encontrada.' }, { status: 404 });
  }

  // Se autenticado: só pode cancelar as próprias queries
  if (userId && query.userId && query.userId !== userId) {
    return NextResponse.json({ success: false, error: 'Não autorizado.' }, { status: 403 });
  }

  // Idempotente: se já foi cancelada ou concluída, não fazer nada
  if (query.status === 'cancelled' || query.status === 'done') {
    return NextResponse.json({ success: true, already: query.status });
  }

  // 1. Marca a query como cancelada no DB
  await db.update(searchQueries).set({ status: 'cancelled' }).where(eq(searchQueries.id, query_id));
  await publishQueryStatus({ query_id, status: 'cancelled' });

  // 2. Marca artigos ainda pendentes/em extração como failed (limpeza)
  const pendingStatuses = ['pending', 'extracting', 'llm_processing'];
  const pendingArticles = await db
    .select({ id: articles.id, status: articles.status })
    .from(articles)
    .where(eq(articles.queryId, query_id));

  const pendingIds = pendingArticles
    .filter((a) => pendingStatuses.includes(a.status))
    .map((a) => a.id);

  if (pendingIds.length > 0) {
    await db.update(articles).set({ status: 'failed' }).where(inArray(articles.id, pendingIds));
  }

  const waitingJobs = await orchestratorQueue.getJobs(['waiting', 'delayed']);
  const toRemove = waitingJobs.filter((job) => job.data.query_id === query_id);
  await Promise.all(toRemove.map((job) => job.remove()));
  await bullmqRedis.set(`cancel:${query_id}`, '1', 'EX', 300);

  logger.info(
    `[Search/Cancel] 🛑 Query cancelada | query_id=${query_id} | pending_articles_marked=${pendingIds.length} | queued_jobs_removed=${toRemove.length}`
  );

  return NextResponse.json({ success: true, cancelled: query_id });
}

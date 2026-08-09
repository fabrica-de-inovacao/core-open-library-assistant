import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const [run] = await db
    .select({
      id: searchQueries.id,
      userId: searchQueries.userId,
      searchGroupId: searchQueries.searchGroupId,
      attempt: searchQueries.attempt,
      source: searchQueries.source,
      status: searchQueries.status,
      expectedCount: searchQueries.expectedCount,
      completedCount: searchQueries.completedCount,
      failedCount: searchQueries.failedCount,
      revision: searchQueries.revision,
    })
    .from(searchQueries)
    .where(eq(searchQueries.id, id))
    .limit(1);

  if (!run || (run.userId && run.userId !== session.user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const attempts = await db
    .select({
      id: searchQueries.id,
      searchGroupId: searchQueries.searchGroupId,
      attempt: searchQueries.attempt,
      source: searchQueries.source,
      status: searchQueries.status,
      originalQuery: searchQueries.originalQuery,
      expectedCount: searchQueries.expectedCount,
      completedCount: searchQueries.completedCount,
      failedCount: searchQueries.failedCount,
      revision: searchQueries.revision,
      createdAt: searchQueries.createdAt,
    })
    .from(searchQueries)
    .where(eq(searchQueries.searchGroupId, run.searchGroupId))
    .orderBy(asc(searchQueries.attempt));
  const rows = await db.select().from(articles).where(eq(articles.queryId, id));
  return NextResponse.json({ run, attempts, articles: rows });
}

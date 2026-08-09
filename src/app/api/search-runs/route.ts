import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const chatId = new URL(request.url).searchParams.get('chatId');
  if (!chatId) return NextResponse.json({ error: 'chatId obrigatorio.' }, { status: 400 });

  const runs = await db
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
    .where(and(eq(searchQueries.chatId, chatId), eq(searchQueries.userId, session.user.id)))
    .orderBy(asc(searchQueries.createdAt));

  return NextResponse.json(runs);
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const [query] = await db
    .select({ id: searchQueries.id, userId: searchQueries.userId, status: searchQueries.status })
    .from(searchQueries)
    .where(eq(searchQueries.id, id))
    .limit(1);

  if (!query || (query.userId && query.userId !== session.user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ status: query.status });
}

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';

const ARTICLE_COLUMNS = {
  id: articles.id,
  queryId: articles.queryId,
  doi: articles.doi,
  title: articles.title,
  authors: articles.authors,
  sourceName: articles.sourceName,
  publicationYear: articles.publicationYear,
  originalUrl: articles.originalUrl,
  status: articles.status,
  markdownContent: articles.markdownContent,
  tldrContent: articles.tldrContent,
  abstract: articles.abstract,
  keywords: articles.keywords,
  citationCount: articles.citationCount,
  publisher: articles.publisher,
  isOpenAccess: articles.isOpenAccess,
  metadataSource: articles.metadataSource,
  citationGraph: articles.citationGraph,
  createdAt: articles.createdAt,
  updatedAt: articles.updatedAt,
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const queryId = searchParams.get('queryId');
  const chatId = searchParams.get('chatId');

  if (!queryId && !chatId) {
    return NextResponse.json({ error: 'queryId ou chatId obrigatório.' }, { status: 400 });
  }

  if (queryId) {
    const rows = await db
      .select(ARTICLE_COLUMNS)
      .from(articles)
      .where(eq(articles.queryId, queryId))
      .orderBy(desc(articles.createdAt));
    return NextResponse.json(rows);
  }

  const rows = await db
    .select(ARTICLE_COLUMNS)
    .from(articles)
    .innerJoin(searchQueries, eq(searchQueries.id, articles.queryId))
    .where(eq(searchQueries.chatId, chatId!))
    .orderBy(desc(articles.createdAt));

  return NextResponse.json(rows);
}

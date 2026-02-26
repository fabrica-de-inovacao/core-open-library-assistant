'use server';

import { db } from '@/server/db';
import { searchQueries, articles, users } from '@/server/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { auth } from '@/auth';

export async function getUserStats() {
  const session = await auth();
  if (!session?.user?.email) {
    return { totalSearches: 0, totalArticles: 0 };
  }

  // Find user by email (as NextAuth default session might not expose DB id without a callback)
  const userRecord = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!userRecord.length) {
    return { totalSearches: 0, totalArticles: 0 };
  }

  const userId = userRecord[0].id;

  // Retrieve user searches
  const queries = await db
    .select({ id: searchQueries.id })
    .from(searchQueries)
    .where(eq(searchQueries.userId, userId));

  const queryIds = queries.map((q) => q.id);

  let articlesCount = 0;
  if (queryIds.length > 0) {
    // Count total extracted articles linked to user's queries
    const arts = await db
      .select({ count: sql<number>`count(*)` })
      .from(articles)
      .where(inArray(articles.queryId, queryIds));

    articlesCount = Number(arts[0].count);
  }

  return {
    totalSearches: queries.length,
    totalArticles: articlesCount,
  };
}

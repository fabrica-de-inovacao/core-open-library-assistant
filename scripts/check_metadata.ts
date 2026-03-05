import { db } from '../src/server/db';
import { articles } from '../src/server/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const recentArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      doi: articles.doi,
      keywords: articles.keywords,
      citationCount: articles.citationCount,
      status: articles.status,
    })
    .from(articles)
    .orderBy(desc(articles.createdAt))
    .limit(10);

  console.log('--- Recent Articles ---');
  for (const a of recentArticles) {
    console.log(`[${a.status}] ${a.title.substring(0, 50)}...`);
    console.log(
      `  DOI: ${a.doi} | Keywords: ${a.keywords ? 'Yes' : 'No'} | Citations: ${a.citationCount}`
    );
  }
  process.exit(0);
}

main().catch(console.error);

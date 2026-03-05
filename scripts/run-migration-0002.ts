/**
 * Utility: Apply only the 0002 enrichment migration to Supabase.
 * Run: npx tsx scripts/run-migration-0002.ts
 */
import * as dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL!;

async function main() {
  const sql = postgres(CONNECTION_STRING, { max: 1 });

  console.log('Applying 0002_add_article_enrichment migration...');

  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "abstract" text`;
  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "keywords" text`;
  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "citation_count" integer`;
  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "publisher" text`;
  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "is_open_access" boolean`;
  await sql`ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "metadata_source" varchar(50) DEFAULT 'scraper'`;

  console.log('✅ Migration applied successfully!');
  await sql.end();
}

main().catch((e) => {
  console.error('❌ Migration failed:', e);
  process.exit(1);
});

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

async function main() {
  try {
    console.log('Dropping old global unique constraint on DOI...');
    await db.execute(sql`ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_doi_unique";`);

    // Sometimes it's created as an index depending on the drizzle version
    try {
      await db.execute(sql`DROP INDEX IF EXISTS "articles_doi_unique";`);
    } catch {
      console.log('Index drop ignored if not exists.');
    }

    console.log('Old constraints potentially dropped successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to drop constraint:', error);
    process.exit(1);
  }
}
main();

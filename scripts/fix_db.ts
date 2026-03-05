import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

async function main() {
  try {
    console.log('Adding "summary" column to "search_queries" table...');
    await db.execute(sql`ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "summary" text;`);
    console.log('Column added successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Failed to add column:', error);
    process.exit(1);
  }
}
main();

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

async function main() {
  try {
    console.log('Querying columns for "search_queries"...');
    const result = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'search_queries'
      ORDER BY ordinal_position;
    `);
    console.log('Columns found:', result);
    process.exit(0);
  } catch (error) {
    console.error('Failed to query columns:', error);
    process.exit(1);
  }
}
main();

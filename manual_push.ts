import * as dotenv from 'dotenv';
dotenv.config();

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(client);

async function main() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "query_id" uuid NOT NULL,
        "role" varchar(50) NOT NULL,
        "content" text NOT NULL,
        "tool_invocations" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    // Add Foreign Key (safe-try)
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_query_id_search_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."search_queries"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Fix integer limits
    await db.execute(sql`ALTER TABLE "articles" ALTER COLUMN "doi" SET DATA TYPE text;`);
    await db.execute(sql`ALTER TABLE "articles" ALTER COLUMN "source_name" SET DATA TYPE text;`);

    console.log('Direct SQL Execution completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Direct execution failed:', error);
    process.exit(1);
  }
}
main();

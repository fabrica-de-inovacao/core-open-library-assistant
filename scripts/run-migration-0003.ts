import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import postgres from 'postgres';

const migration = `
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "chat_id" uuid REFERENCES "chat_sessions"("id") ON DELETE SET NULL;

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "chat_id" uuid REFERENCES "chat_sessions"("id") ON DELETE CASCADE;

ALTER TABLE "chat_messages" ALTER COLUMN "query_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "chat_messages_chat_id_idx" ON "chat_messages" ("chat_id");

CREATE INDEX IF NOT EXISTS "search_queries_chat_id_idx" ON "search_queries" ("chat_id");
`;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await sql.unsafe(migration);
    console.log('✅ Migration 0003 (chat_sessions) aplicada com sucesso!');
  } catch (e) {
    console.error('❌ Erro na migration:', (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();

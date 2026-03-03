import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import postgres from 'postgres';

const migration = `
ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "conversation_summary" text;

ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "conversation_summary_count" integer NOT NULL DEFAULT 0;
`;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await sql.unsafe(migration);
    console.log('✅ Migration 0006 (conversation_summary) aplicada com sucesso!');
  } catch (e) {
    console.error('❌ Erro na migration:', (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();

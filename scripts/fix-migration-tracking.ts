/**
 * fix-migration-tracking.ts
 *
 * Registra as migrations 0000–0004 na tabela `drizzle.__drizzle_migrations`
 * (caso ainda não existam) e depois aplica a migration 0005 diretamente.
 *
 * Executar: npx tsx scripts/fix-migration-tracking.ts
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.join(process.cwd(), 'src/server/db/migrations');

const JOURNAL: Array<{ idx: number; tag: string; when: number }> = [
  { idx: 0, tag: '0000_fantastic_cable', when: 1771886417737 },
  { idx: 1, tag: '0001_confused_justice', when: 1772041585645 },
  { idx: 2, tag: '0002_add_article_enrichment', when: 1772066648882 },
  { idx: 3, tag: '0003_chat_sessions', when: 1740873600000 },
  { idx: 4, tag: '0004_add_abstract_embedding', when: 1740960000000 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida no .env');

  const sql = postgres(url, { max: 1 });

  // 1. Garante que o schema e a tabela de controle existem
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id       SERIAL PRIMARY KEY,
      hash     TEXT   NOT NULL,
      created_at BIGINT
    )
  `;

  // 2. Pega os hashes já gravados
  const existing = await sql<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations
  `;
  const existingHashes = new Set(existing.map((r) => r.hash));

  // 3. Registra 0000–0004 que já estão no banco mas não no tracker
  for (const entry of JOURNAL) {
    const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  Arquivo não encontrado: ${entry.tag}.sql — pulando`);
      continue;
    }
    const content = fs.readFileSync(file, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    if (existingHashes.has(hash)) {
      console.log(`✅ já registrada: ${entry.tag}`);
      continue;
    }

    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
    `;
    console.log(`📝 registrada: ${entry.tag} (hash: ${hash.slice(0, 12)}...)`);
  }

  // 4. Aplica a migration 0005 diretamente
  const migration0005 = path.join(MIGRATIONS_DIR, '0005_pgvector_and_url_idx.sql');
  if (!fs.existsSync(migration0005)) {
    throw new Error('Migration 0005 não encontrada!');
  }

  const sql0005 = fs.readFileSync(migration0005, 'utf-8');
  const hash0005 = createHash('sha256').update(sql0005).digest('hex');

  if (existingHashes.has(hash0005)) {
    console.log('✅ Migration 0005 já estava aplicada.');
  } else {
    console.log('🚀 Aplicando migration 0005_pgvector_and_url_idx…');

    // Executa cada statement separado por breakpoint (Drizzle usa `--> statement-breakpoint`)
    const statements = sql0005
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
        console.log(`   ✓ ${stmt.slice(0, 60).replace(/\n/g, ' ')}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Ignora erros "já existe" — idempotente
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate column') ||
          msg.includes('42P07') ||
          msg.includes('42701')
        ) {
          console.warn(`   ⚠️  ignorado (já existe): ${msg.slice(0, 80)}`);
        } else {
          throw err;
        }
      }
    }

    // Registra a 0005 no tracker
    const when0005 = 1772332800000;
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash0005}, ${when0005})
    `;
    console.log('✅ Migration 0005 aplicada e registrada com sucesso!');
  }

  await sql.end();
  console.log('\n✅ Banco de dados atualizado.');
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});

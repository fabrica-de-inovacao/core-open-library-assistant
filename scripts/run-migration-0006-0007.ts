/**
 * scripts/run-migration-0006-0007.ts
 *
 * Aplica as migrations 0006 e 0007 ao banco Supabase.
 *
 * 0006: Adiciona citation_graph (JSONB) em articles e query_embedding (vector(768)) em search_queries.
 * 0007: Cria índice HNSW em abstract_embedding + função match_articles (RAG de cache).
 *
 * Uso:
 *   npx tsx scripts/run-migration-0006-0007.ts
 *
 * OU via drizzle-kit (aplica TODAS as pending migrations automaticamente):
 *   yarn db:migrate
 */

import * as dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL!;

async function main() {
  const sql = postgres(CONNECTION_STRING, { max: 1 });

  console.log('🔄 Aplicando migration 0006: citation_graph + query_embedding…');

  await sql`
    ALTER TABLE "articles"
      ADD COLUMN IF NOT EXISTS "citation_graph" jsonb
  `;
  await sql`
    ALTER TABLE "search_queries"
      ADD COLUMN IF NOT EXISTS "query_embedding" vector(768)
  `;

  console.log('✅ 0006 OK');

  console.log('🔄 Aplicando migration 0007: índice HNSW + função match_articles…');

  // Índice HNSW para busca ANN em abstract_embedding (pgvector)
  await sql`
    CREATE INDEX IF NOT EXISTS articles_abstract_embedding_hnsw_idx
      ON articles
      USING hnsw (abstract_embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `;

  // RPC match_articles — busca semântica com threshold de similaridade
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION match_articles(
      query_embedding  vector(768),
      match_threshold  float DEFAULT 0.75,
      match_count      int   DEFAULT 20,
      p_user_id        text  DEFAULT NULL
    )
    RETURNS TABLE(
      id               uuid,
      title            text,
      doi              text,
      abstract         text,
      tldr_content     text,
      source_name      text,
      publication_year integer,
      citation_count   integer,
      original_url     text,
      similarity       float
    )
    LANGUAGE sql STABLE
    AS $$
      SELECT
        a.id,
        a.title,
        a.doi,
        a.abstract,
        a.tldr_content,
        a.source_name,
        a.publication_year,
        a.citation_count,
        a.original_url,
        1 - (a.abstract_embedding <=> query_embedding) AS similarity
      FROM articles a
      INNER JOIN search_queries sq ON sq.id = a.query_id
      WHERE
        a.abstract_embedding IS NOT NULL
        AND a.status IN ('done', 'abstract_only')
        AND (p_user_id IS NULL OR sq.user_id = p_user_id)
        AND 1 - (a.abstract_embedding <=> query_embedding) > match_threshold
      ORDER BY a.abstract_embedding <=> query_embedding
      LIMIT match_count;
    $$;
  `);

  console.log('✅ 0007 OK');
  console.log('\n🎉 Migrations aplicadas com sucesso!');
  console.log('   Próximo passo: yarn dev para testar o RAG de cache.');

  await sql.end();
}

main().catch((e) => {
  console.error('❌ Migration falhou:', e);
  process.exit(1);
});

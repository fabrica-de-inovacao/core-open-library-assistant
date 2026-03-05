-- Migration 0005: pgvector + url_query_idx
--
-- P-10: Adiciona índice único (query_id, original_url) para evitar artigos duplicados
--       sem DOI dentro da mesma query.
--
-- P-19: Habilita extensão pgvector e migra abstract_embedding de TEXT → vector(768).
--       O formato JSON "[f1, f2, ...]" armazenado anteriormente é compatível com o
--       casting direto para o tipo vector do PostgreSQL.
--
-- DEPENDÊNCIAS: Requer pgvector no servidor (disponível no Supabase por padrão).
-- ATENÇÃO: Esta migration é irreversível. Faça backup antes de executar.

-- ═══════════════════════════════════════════════════════════════════════════
-- Extensão pgvector
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════
-- P-10: Índice único por URL por query
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS url_query_idx
  ON articles (query_id, original_url);

-- ═══════════════════════════════════════════════════════════════════════════
-- P-19: Migrar abstract_embedding de TEXT para vector(768)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Adiciona coluna temporária com o tipo correto
ALTER TABLE articles
  ADD COLUMN abstract_embedding_vec vector(768);

-- 2. Migra dados válidos: JSON "[f1, f2, ...]" é compatível com pgvector::vector
UPDATE articles
   SET abstract_embedding_vec = abstract_embedding::vector
 WHERE abstract_embedding IS NOT NULL
   AND abstract_embedding != ''
   AND abstract_embedding ~ '^\[[-0-9]';

-- 3. Remove coluna TEXT antiga e renomeia a nova
ALTER TABLE articles DROP COLUMN abstract_embedding;
ALTER TABLE articles RENAME COLUMN abstract_embedding_vec TO abstract_embedding;

-- 4. Índice IVFFlat para busca por similaridade de cosseno (Fase 2 — reranking semântico)
--    Requer ao menos 100 linhas no banco para criar o índice.
--    Descomente após popular a base com embeddings suficientes:
--
-- CREATE INDEX IF NOT EXISTS articles_embedding_cos_idx
--   ON articles USING ivfflat (abstract_embedding vector_cosine_ops)
--   WITH (lists = 100);

COMMENT ON COLUMN articles.abstract_embedding IS
  'Embedding do abstract para reranking semântico (vector 768 dims, text-embedding-004). '
  'Calculado pelo Inngest step embed-abstract-{id}. ';

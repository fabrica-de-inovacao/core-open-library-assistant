-- Migration 0003: Adiciona coluna abstract_embedding à tabela articles
-- Fase 1 do I-03: coluna TEXT armazena embedding serializado como JSON array.
-- Fase 2 (futura): migrar para pgvector com tipo VECTOR(768) via extensão.
--
-- IMPORTANTE: execute esta migration ANTES de deployar a versão
-- do inngest/functions.ts que calcula embeddings (I-03 Step 2).

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS abstract_embedding TEXT;

-- Índice futuro para busca por similaridade (placeholder — requer pgvector):
-- CREATE INDEX IF NOT EXISTS articles_embedding_idx ON articles
--   USING ivfflat (abstract_embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON COLUMN articles.abstract_embedding IS
  'Embedding do abstract serializado como JSON array de floats. '
  'Calculado pelo Inngest após enriquecimento CrossRef. '
  'Formato: "[0.123, -0.456, ...]" (vetor text-embedding-004 ou equivalente).';

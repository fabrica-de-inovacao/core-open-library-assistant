-- Fase 6 (P-seguinte): RAG de Cache — Índice HNSW + RPC match_articles (1.2.2)
--
-- Depende de:
--   0004_add_abstract_embedding.sql — coluna abstract_embedding vector(768)
--   0006_citation_graph_and_query_embed.sql — (opcional, ordem segura)
--
-- O índice HNSW permite busca ANN (Approximate Nearest Neighbor) eficiente no
-- pgvector. Sem ele, toda chamada à match_articles faria um full table scan.
-- m=16, ef_construction=64 → valores padrão de boa relação recall/performance.

-- ── Passo 1: Índice HNSW em abstract_embedding ──────────────────────────────
CREATE INDEX IF NOT EXISTS articles_abstract_embedding_hnsw_idx
  ON articles
  USING hnsw (abstract_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);--> statement-breakpoint

-- ── Passo 2: Função match_articles ──────────────────────────────────────────
-- Retorna artigos cujo abstract_embedding tem cosine similarity > match_threshold.
-- Filtra apenas artigos com status done/abstract_only (corpus finalizado).
-- p_user_id (text) filtra pelo user_id do dono da query, quando fornecido.
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

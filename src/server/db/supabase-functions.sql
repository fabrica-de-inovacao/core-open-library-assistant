-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 6 (P-seguinte): RAG de Cache — Infra Supabase (1.2.2)
--
-- INSTRUÇÕES DE APLICAÇÃO:
--   1. Acesse o Supabase Dashboard → SQL Editor
--   2. Execute os dois blocos abaixo NA ORDEM indicada
--   3. NÃO incluir em migrations Drizzle (é DDL gerenciado pelo Supabase)
--
-- ATENÇÃO: o índice HNSW leva alguns segundos para construir no Supabase.
--   Execute em horário de baixo tráfego.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Passo 1: Índice HNSW para busca ANN eficiente em abstract_embedding ─────
--
-- HNSW (Hierarchical Navigable Small World) é o índice recomendado pelo
-- pgvector para workloads de busca semântica em tempo real.
-- m=16 e ef_construction=64 são os valores padrão para boa relação recall/perf.
-- Para tabelas grandes (> 1M linhas), considerar aumentar ef_construction para 128.
--
CREATE INDEX IF NOT EXISTS articles_abstract_embedding_hnsw_idx
  ON articles
  USING hnsw (abstract_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Passo 2: RPC match_articles — busca semântica com threshold ──────────────
--
-- Retorna artigos cuja embedding de abstract tem cosine similarity > match_threshold
-- com a query_embedding fornecida.
--
-- Parâmetros:
--   query_embedding   — vector(768) gerado pelo Orchestrator (gemini-embedding-001)
--   match_threshold   — limiar de similaridade (padrão: 0.75)
--   match_count       — número máximo de resultados (padrão: 20)
--   p_user_id         — quando não-NULL, filtra por artigos do próprio usuário
--                       (via queries do usuário — join com search_queries)
--
-- Para chamar via Supabase Client:
--   const { data } = await supabase.rpc('match_articles', {
--     query_embedding: [...],   // number[] com 768 dimensões
--     match_threshold: 0.75,
--     match_count: 20,
--   });
--
CREATE OR REPLACE FUNCTION match_articles(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.75,
  match_count     int   DEFAULT 20,
  p_user_id       text  DEFAULT NULL   -- text para compatibilidade com o tipo users.id
)
RETURNS TABLE(
  id          uuid,
  title       text,
  doi         text,
  abstract    text,
  tldr_content text,
  source_name text,
  publication_year integer,
  citation_count   integer,
  original_url     text,
  similarity  float
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

-- ── Passo 3 (opcional): índice em query_embedding para similaridade entre queries ──
--
-- Útil para o banner "você pesquisou algo similar" (feature 1.2.3).
-- Só valerá a pena quando a tabela search_queries tiver > 10k linhas com embedding.
--
-- CREATE INDEX IF NOT EXISTS search_queries_query_embedding_hnsw_idx
--   ON search_queries
--   USING hnsw (query_embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64);

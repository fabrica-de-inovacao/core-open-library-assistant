-- Fase 8 (P-trending): covering index para a query de trending topics.
-- WHERE status = 'done' + GROUP BY original_query → index-only scan.
-- Sem este índice: full table scan em search_queries a cada hora.
CREATE INDEX IF NOT EXISTS "search_queries_status_oq_idx"
  ON "search_queries" ("status", "original_query");

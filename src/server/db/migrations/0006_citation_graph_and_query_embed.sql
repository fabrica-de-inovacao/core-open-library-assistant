-- Fase 6 (P-seguinte): Sprint Seguinte — Grafo de Citações (1.2.1) + Embedding de Query (1.2.3)
--
-- citation_graph: armazena referências (backward) e citações (forward) obtidas da
--   Semantic Scholar API. Formato:
--   { "references": [{id, title, doi}...], "citations": [{id, title, doi}...], "fetched_at": "ISO" }
--
-- query_embedding: embedding semântico da query original (gemini-embedding-001, 768 dims).
--   Permite detectar queries similares anteriores e alimentar RAG de cache entre sessões.

ALTER TABLE "articles" ADD COLUMN "citation_graph" jsonb;--> statement-breakpoint
ALTER TABLE "search_queries" ADD COLUMN "query_embedding" vector(768);

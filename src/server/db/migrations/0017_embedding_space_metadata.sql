ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "embedding_provider" text;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "embedding_model" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "embedding_provider" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "embedding_model" text;

UPDATE "search_queries"
SET embedding_provider = COALESCE(embedding_provider, 'google'),
    embedding_model = COALESCE(embedding_model, 'gemini-embedding-001')
WHERE query_embedding IS NOT NULL;

UPDATE "articles"
SET embedding_provider = COALESCE(embedding_provider, 'google'),
    embedding_model = COALESCE(embedding_model, 'gemini-embedding-001')
WHERE abstract_embedding IS NOT NULL;

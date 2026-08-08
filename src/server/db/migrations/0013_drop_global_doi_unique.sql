ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_doi_unique;
CREATE UNIQUE INDEX IF NOT EXISTS doi_query_idx ON articles (query_id, doi);

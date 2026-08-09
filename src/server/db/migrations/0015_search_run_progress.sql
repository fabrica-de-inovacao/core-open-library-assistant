ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "completed_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "failed_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;

UPDATE "search_queries" sq
SET completed_count = counts.completed_count,
    failed_count = counts.failed_count
FROM (
  SELECT query_id,
         count(*) FILTER (WHERE status IN ('done', 'abstract_only'))::integer AS completed_count,
         count(*) FILTER (WHERE status = 'failed')::integer AS failed_count
  FROM articles
  GROUP BY query_id
) counts
WHERE sq.id = counts.query_id;

CREATE OR REPLACE FUNCTION sync_search_query_progress()
RETURNS trigger AS $$
DECLARE
  affected_query_id uuid;
BEGIN
  affected_query_id := COALESCE(NEW.query_id, OLD.query_id);
  UPDATE search_queries sq
  SET completed_count = (
        SELECT count(*)::integer FROM articles a
        WHERE a.query_id = affected_query_id AND a.status IN ('done', 'abstract_only')
      ),
      failed_count = (
        SELECT count(*)::integer FROM articles a
        WHERE a.query_id = affected_query_id AND a.status = 'failed'
      ),
      revision = revision + 1
  WHERE sq.id = affected_query_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS articles_sync_search_query_progress ON articles;
CREATE TRIGGER articles_sync_search_query_progress
AFTER INSERT OR DELETE OR UPDATE OF status ON articles
FOR EACH ROW EXECUTE FUNCTION sync_search_query_progress();

CREATE OR REPLACE FUNCTION bump_search_query_revision()
RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.status, NEW.expected_count, NEW.source, NEW.attempt, NEW.search_group_id)
     IS DISTINCT FROM
     ROW(OLD.status, OLD.expected_count, OLD.source, OLD.attempt, OLD.search_group_id) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS search_queries_bump_revision ON search_queries;
CREATE TRIGGER search_queries_bump_revision
BEFORE UPDATE ON search_queries
FOR EACH ROW EXECUTE FUNCTION bump_search_query_revision();

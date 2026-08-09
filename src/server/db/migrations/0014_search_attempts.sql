ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "search_group_id" uuid;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 1 NOT NULL;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'sol' NOT NULL;
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "expected_count" integer DEFAULT 0 NOT NULL;

UPDATE "search_queries"
SET "search_group_id" = gen_random_uuid()
WHERE "search_group_id" IS NULL;

ALTER TABLE "search_queries" ALTER COLUMN "search_group_id" SET DEFAULT gen_random_uuid();
ALTER TABLE "search_queries" ALTER COLUMN "search_group_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "search_queries_group_attempt_idx"
ON "search_queries" ("search_group_id", "attempt");

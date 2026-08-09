CREATE TABLE IF NOT EXISTS "llm_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "request_id" text,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "task" text NOT NULL,
  "credential_mode" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "estimated_cost_microusd" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "llm_usage_events_user_created_idx"
ON "llm_usage_events" ("user_id", "created_at");

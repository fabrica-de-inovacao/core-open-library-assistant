CREATE TABLE IF NOT EXISTS "user_llm_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "provider" text DEFAULT 'google' NOT NULL,
  "encrypted_api_key" text,
  "api_key_last4" text,
  "models" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "use_own_key" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "user_llm_settings"
    ADD CONSTRAINT "user_llm_settings_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_llm_settings_user_id_idx" ON "user_llm_settings" ("user_id");

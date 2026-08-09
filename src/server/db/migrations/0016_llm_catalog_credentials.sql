ALTER TABLE "user_llm_settings" ADD COLUMN IF NOT EXISTS "preset" text DEFAULT 'balanced' NOT NULL;

CREATE TABLE IF NOT EXISTS "user_provider_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "encrypted_api_key" text NOT NULL,
  "api_key_last4" text NOT NULL,
  "validated_at" timestamp,
  "validation_status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_provider_credentials_user_provider_idx"
ON "user_provider_credentials" ("user_id", "provider");

INSERT INTO "user_provider_credentials" ("user_id", "provider", "encrypted_api_key", "api_key_last4", "validation_status")
SELECT "user_id", "provider", "encrypted_api_key", COALESCE("api_key_last4", ''), 'legacy'
FROM "user_llm_settings"
WHERE "encrypted_api_key" IS NOT NULL
ON CONFLICT ("user_id", "provider") DO NOTHING;

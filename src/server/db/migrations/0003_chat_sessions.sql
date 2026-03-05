-- Fase 1 (P-01): Introduz chat_sessions como objeto primário de sessão.
-- Antes: chatMessages.queryId era a âncora — 1 query = 1 conversa.
-- Agora: 1 chatSession = N searchQueries + N chatMessages.
-- Elimina race conditions de segunda busca e histórico vazio.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- Vincula searchQueries à sessão de chat mãe (nullable: retrocompatível)
ALTER TABLE "search_queries" ADD COLUMN IF NOT EXISTS "chat_id" uuid REFERENCES "chat_sessions"("id") ON DELETE SET NULL;

--> statement-breakpoint
-- Vincula chatMessages à sessão (nullable: retrocompatível)
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "chat_id" uuid REFERENCES "chat_sessions"("id") ON DELETE CASCADE;

--> statement-breakpoint
-- queryId em chat_messages passa a ser nullable (era NOT NULL)
ALTER TABLE "chat_messages" ALTER COLUMN "query_id" DROP NOT NULL;

--> statement-breakpoint
-- Índice para busca eficiente de mensagens por chatId
CREATE INDEX IF NOT EXISTS "chat_messages_chat_id_idx" ON "chat_messages" ("chat_id");

--> statement-breakpoint
-- Índice para busca eficiente de queries por chatId
CREATE INDEX IF NOT EXISTS "search_queries_chat_id_idx" ON "search_queries" ("chat_id");

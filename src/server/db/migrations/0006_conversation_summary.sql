-- Migration 0006: cache de sumarização de histórico longo
--
-- V2 da compressão de histórico: salva o resumo gerado na chat_session
-- para reutilizá-lo nos requests seguintes sem chamar o LLM novamente.
--
-- conversation_summary      : texto comprimido do histórico antigo
-- conversation_summary_count: quantas mensagens foram cobertas pelo resumo
--   → quando messages.length - count >= KEEP_RECENT (14), o resumo é regenerado

ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "conversation_summary" text;

ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "conversation_summary_count" integer NOT NULL DEFAULT 0;

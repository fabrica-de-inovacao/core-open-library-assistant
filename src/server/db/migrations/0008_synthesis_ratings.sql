-- Fase C (Batch 3): persiste feedback pós-síntese por mensagem.
-- Estrutura JSONB: { [messageId]: 'up' | 'down' }
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS synthesis_ratings jsonb DEFAULT '{}'::jsonb;

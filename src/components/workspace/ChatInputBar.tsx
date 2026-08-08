'use client';

/**
 * components/workspace/ChatInputBar.tsx
 *
 * Área de input do workspace em modo de sessão ativa.
 * Contém:
 * - Badge de mensagem pendente (P-abort)
 * - Chips de sugestão rápida (P-chips)
 * - Textarea + botão de anexo + botão enviar/abortar
 * - Toolbar inferior (cobertura + limite de artigos + modo de síntese)
 */

import TextareaAutosize from 'react-textarea-autosize';
import { Paperclip, Send, Square, Library, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AttachmentChip } from '@/components/workspace/AttachmentChip';
import { InputToolbar } from '@/components/workspace/InputToolbar';
import { useState } from 'react';
import type { useAttachments } from '@/hooks/useAttachments';
import type { AnalysisMode } from '@/hooks/useSearchSettings';

interface ChatInputBarProps {
  // Input principal
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit: (e?: React.FormEvent<HTMLFormElement>) => void;

  // Estado de loading/abort
  showAbortButton: boolean;
  onAbort: () => void;

  // Mensagem pendente na fila (P-abort)
  pendingMessage?: string;
  hasPendingExtractions?: boolean;

  // Estado de anexos (hook consolidado)
  attachments: ReturnType<typeof useAttachments>;

  // Modo de análise unificado
  analysisMode?: AnalysisMode;
  onAnalysisModeChange?: (m: AnalysisMode) => void;
  // Modelos vêm de Configurações → IA
}

export function ChatInputBar({
  input,
  onInputChange,
  onSubmit,
  showAbortButton,
  onAbort,
  pendingMessage,
  attachments,
  analysisMode,
  onAnalysisModeChange,
}: ChatInputBarProps) {
  const { chips, uploadState, doiState, setIsAttachDialogOpen, removeChip } = attachments;

  // BUG-05: mostra spinner no botão de envio entre o click e o início do stream (showAbortButton=true)
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Quando o stream começa (showAbortButton vira true), o isSubmitting é desnecessário
  const showSpinner = isSubmitting && !showAbortButton;

  const handleSubmitWithLoading = (e?: React.FormEvent<HTMLFormElement>) => {
    if (!input.trim()) return;
    setIsSubmitting(true);
    onSubmit(e);
  };

  /** Enter envia; Shift+Enter adiciona nova linha */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitWithLoading();
    }
  };

  return (
    <div className="bg-background/95 px-4 py-3 backdrop-blur-sm">
      {/* ── Badge: mensagem na fila (P-abort) ── */}
      {pendingMessage && (
        <div className="animate-in slide-in-from-bottom-2 fade-in mx-auto mb-2 flex max-w-2xl items-center gap-2 duration-200">
          <div className="border-border/60 bg-muted/60 text-foreground/70 flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] shadow-sm backdrop-blur-sm">
            <Clock className="text-muted-foreground h-3 w-3 shrink-0" />
            <span className="text-muted-foreground shrink-0 font-medium">Na fila:</span>
            <span className="min-w-0 truncate italic">&ldquo;{pendingMessage}&rdquo;</span>
          </div>
        </div>
      )}



      {/* ── Formulário principal ── */}
      <form onSubmit={handleSubmitWithLoading} className="mx-auto max-w-2xl">
        <div className="border-border bg-card focus-within:border-primary focus-within:ring-primary rounded-2xl border shadow-sm transition-all focus-within:ring-1">
          {/* Chips de anexos */}
          {chips.length > 0 && (
            <div className="animate-in fade-in slide-in-from-top-1 flex flex-wrap gap-2 border-b px-3 py-2.5 duration-200">
              {chips.map((chip) => (
                <AttachmentChip key={chip.id} {...chip} onRemove={removeChip} />
              ))}
            </div>
          )}

          {/* Textarea + botões absolutos */}
          <div className="relative">
            <TextareaAutosize
              value={input}
              onChange={onInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                showAbortButton
                  ? 'Responderei assim que terminar…'
                  : 'Responda ou faça uma nova iteração…'
              }
              minRows={1}
              maxRows={6}
              className="text-foreground placeholder:text-muted-foreground/50 w-full resize-none bg-transparent py-3 pr-12 pl-11 font-sans text-sm leading-relaxed outline-none"
            />

            {/* Botão anexar — esquerda */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setIsAttachDialogOpen(true)}
              disabled={uploadState === 'uploading' || doiState === 'loading'}
              title="Anexar PDF ou adicionar por DOI"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 left-1.5 h-8 w-8 -translate-y-1/2 rounded-xl"
            >
              {uploadState === 'uploading' || doiState === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>

            {/* Botão enviar / abortar — direita */}
            {showAbortButton ? (
              <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
                {/* Anel giratório externo — vermelho */}
                <div className="pointer-events-none absolute inset-0 animate-spin rounded-xl border-2 border-rose-500/20 border-t-rose-500/70" />
                <Button
                  type="button"
                  size="icon"
                  onClick={onAbort}
                  title="Interromper geração"
                  className="relative h-8 w-8 rounded-xl border border-rose-500/40 bg-rose-500/10 shadow-sm transition-all hover:bg-rose-500/20 focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <Library className="text-primary absolute h-3.5 w-3.5 opacity-25" />
                  <Square className="relative h-2.5 w-2.5 fill-rose-500 text-rose-500" />
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || showSpinner}
                className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary absolute top-1/2 right-1.5 h-8 w-8 -translate-y-1/2 rounded-xl shadow-sm transition-all focus-visible:ring-2 disabled:opacity-40"
              >
                {showSpinner ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>

          {/* Toolbar inferior */}
          <InputToolbar
            analysisMode={analysisMode}
            onAnalysisModeChange={onAnalysisModeChange}
          />
        </div>

        {/* Disclaimer */}
        <p className="text-muted-foreground/40 mt-2 text-center text-[10px]">
          C.O.R.E. AI pode cometer erros. Verifique as fontes no acervo.
        </p>
      </form>
    </div>
  );
}

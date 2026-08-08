'use client';

/**
 * components/workspace/home/HomeView.tsx
 *
 * Vista hero do workspace — exibida quando não há sessão ativa.
 * Contém: headline, input principal com toolbar, popover de anexo, trending topics.
 * Trending topics são fetched internamente — não precisam vir como props.
 */

import { useEffect, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Paperclip, ArrowUp, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AttachmentChip } from '@/components/workspace/AttachmentChip';
import { AttachContent } from '@/components/workspace/AttachContent';
import { InputToolbar } from '@/components/workspace/InputToolbar';
import { TrendingTopics } from '@/components/workspace/home/TrendingTopics';
import { signIn } from 'next-auth/react';
import type { useAttachments } from '@/hooks/useAttachments';
import type { AnalysisMode } from '@/hooks/useSearchSettings';
import type { TrendingTopic } from '@/app/api/trending-topics/route';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type AttachmentsReturn = ReturnType<typeof useAttachments>;

interface HomeViewProps {
  /** Callback chamado quando o utilizador submete a consulta inicial */
  onSubmitQuery: (text: string) => void;
  isLoading: boolean;

  // Modo de análise unificado (substitui searchLimit + synthesisMode)
  analysisMode?: AnalysisMode;
  onAnalysisModeChange?: (m: AnalysisMode) => void;

  // Modelos vêm de Configurações → IA; sem seletor no workspace

  // Anexos (PDF/DOI) — hook consolidado do useAttachments
  attachments: AttachmentsReturn;

  // Auth
  authStatus: 'authenticated' | 'unauthenticated' | 'loading';

  /** Abre modal de login — recebe o texto pendente para retomar após login */
  onShowLoginModal?: (pendingText?: string) => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function HomeView({
  onSubmitQuery,
  isLoading,
  analysisMode = 'auto',
  onAnalysisModeChange,
  attachments,
  authStatus,
  onShowLoginModal,
}: HomeViewProps) {
  // Input gerido internamente — HomeView é um formulário auto-suficiente
  const [input, setInput] = useState('');
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInput(e.target.value);

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (authStatus === 'unauthenticated') {
      if (onShowLoginModal) {
        onShowLoginModal(input.trim() || undefined);
      } else {
        void signIn('google', { callbackUrl: '/workspace' });
      }
      return;
    }
    if (!input.trim()) return;
    onSubmitQuery(input.trim());
    setInput('');
    attachments.clearChips();
  };

  const {
    chips,
    removeChip,
    uploadState,
    fileInputRef,
    submitPdfFile,
    doiInput,
    setDoiInput,
    doiState,
    handleDoiSubmit,
    isDropZoneActive,
    setIsDropZoneActive,
    showAttachPopover,
    setShowAttachPopover,
    closeAttachPopover,
  } = attachments;

  // --- Trending topics — fetched aqui, não dependem de props --------------
  const [topics, setTopics] = useState<TrendingTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/trending-topics')
      .then((r) => r.json() as Promise<{ topics: TrendingTopic[] }>)
      .then(({ topics: t }) => setTopics(t ?? []))
      .catch(() => setTopics([]))
      .finally(() => setTopicsLoading(false));
  }, []);

  /** Enter envia; Shift+Enter adiciona nova linha */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pt-4 pb-8">
      <div className="w-full max-w-3xl">
        {/* ── Headline ── */}
        <div className="mb-8 text-center">
          <h1 className="text-foreground mb-4 text-[2.4rem] leading-[1.2] font-bold tracking-tight">
            Pesquise literatura científica
            <br />
            <span className="text-primary">como você pensa</span>
          </h1>
          <p className="text-muted-foreground mx-auto max-w-xl text-[15px] leading-relaxed">
            Só descreva o que você quer pesquisar. A C.O.R.E. encontra, lê e organiza a literatura
            científica ibero-americana mais relevante para você.
          </p>
        </div>

        {/* ── Input principal com toolbar ── */}
        <form onSubmit={handleSubmit}>
          <div className="border-border bg-card focus-within:border-primary/60 focus-within:ring-primary/20 overflow-hidden rounded-2xl border shadow-lg transition-all focus-within:ring-2">
            {/* Chips de anexos */}
            {chips.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-1 flex flex-wrap gap-2 px-4 pt-3 pb-1 duration-200">
                {chips.map((chip) => (
                  <AttachmentChip key={chip.id} {...chip} onRemove={removeChip} />
                ))}
              </div>
            )}

            {/* Área de texto */}
            <TextareaAutosize
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ex: Impacto da IA generativa no desempenho de estudantes do ensino médio..."
              minRows={2}
              maxRows={6}
              disabled={isLoading}
              className="text-foreground placeholder:text-muted-foreground/40 w-full resize-none bg-transparent px-5 pt-4 pb-2 font-sans text-[15px] leading-relaxed outline-none"
            />

            {/* Toolbar inferior */}
            <InputToolbar
              analysisMode={analysisMode}
              onAnalysisModeChange={onAnalysisModeChange}
              leftSlot={
                <>
                  <Popover
                    open={showAttachPopover}
                    onOpenChange={(open) => {
                      if (open) setShowAttachPopover(true);
                      else closeAttachPopover();
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Anexar PDF ou adicionar por DOI"
                        className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        <span>Anexar</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      sideOffset={10}
                      className="w-[300px] p-4"
                    >
                      <p className="text-foreground mb-3 text-sm font-medium">
                        Adicionar ao acervo
                      </p>
                      <AttachContent
                        variant="compact"
                        uploadState={uploadState}
                        doiInput={doiInput}
                        doiState={doiState}
                        isDropZoneActive={isDropZoneActive}
                        onDropZoneDragOver={(e) => {
                          e.stopPropagation();
                          setIsDropZoneActive(true);
                        }}
                        onDropZoneDragLeave={() => setIsDropZoneActive(false)}
                        onDropZoneDrop={(e) => {
                          setIsDropZoneActive(false);
                          Array.from(e.dataTransfer.files)
                            .filter((f) => f.type === 'application/pdf')
                            .forEach((f) => submitPdfFile(f));
                          setShowAttachPopover(false);
                        }}
                        onDropZoneClick={() => fileInputRef.current?.click()}
                        onDoiChange={(val) => setDoiInput(val)}
                        onDoiSubmit={handleDoiSubmit}
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="bg-border/40 h-3 w-px" />
                </>
              }
              rightSlot={
                <>
                  <div className="bg-border/40 h-3 w-px" />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground flex h-8 w-8 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed"
                    title="Enviar pesquisa"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </button>
                </>
              }
            />
          </div>
        </form>

        {/* ── Trending Topics ── */}
        <TrendingTopics
          topics={topics}
          isLoading={topicsLoading}
          onSelect={(label) => {
            setInput(label);
            if (authStatus === 'unauthenticated') {
              if (onShowLoginModal) {
                onShowLoginModal(label);
              } else {
                void signIn('google', { callbackUrl: '/workspace' });
              }
            }
          }}
        />
      </div>
    </div>
  );
}

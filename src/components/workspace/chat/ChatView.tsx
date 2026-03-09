'use client';

/**
 * components/workspace/chat/ChatView.tsx
 *
 * Vista completa da sessão de chat activa.
 * Contém tudo que é específico do modo conversa:
 *  - scroll (ref + botão)
 *  - highlightedRow (sincronização com ExtractionsPanel)
 *  - isPanelOpen (painel lateral de extrações)
 *  - input + submit (envio de mensagens)
 *  - chips de sugestão rápida
 *  - QueryHistoryBar + lista de mensagens + TypingIndicator
 *  - ResizablePanelGroup com ChatInputBar e ExtractionsPanel
 *  - AttachDialog (versão expandida — usada só no chat)
 *
 * O que NÃO está aqui:
 *  - Lógica de auth (vem do page.tsx via props)
 *  - Lógica de settings (model/limit — vem via props)
 *  - useChatOrchestration / useAttachments (instanciados no page.tsx)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { isToolOrDynamicToolUIPart, getToolOrDynamicToolName } from 'ai';
import { signIn } from 'next-auth/react';
import { ChevronsDown, ChevronLeft, BookOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ChatMessageItem, TypingIndicator } from '@/components/workspace/ChatMessageItem';
import { ExtractionsPanel } from '@/components/workspace/ExtractionsPanel';
import { QueryHistoryBar } from '@/components/workspace/QueryHistoryBar';
import { ChatInputBar } from '@/components/workspace/ChatInputBar';
import { AttachContent } from '@/components/workspace/AttachContent';
import { PipelineStatusBar } from '@/components/workspace/PipelineStatusBar';
import type { SearchAttempt } from '@/components/workspace/proposals';
import { useSidebar } from '@/components/ui/sidebar';
import type { useChatOrchestration } from '@/hooks/useChatOrchestration';
import type { useAttachments } from '@/hooks/useAttachments';
import type { AnalysisMode, ModelValue } from '@/hooks/useSearchSettings';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ChatViewProps {
  /** Sessão do utilizador (para exibir o nome no avatar das mensagens) */
  userName: string | null | undefined;
  /** Status de autenticação — necessário para guard no submit */
  authStatus: 'authenticated' | 'unauthenticated' | 'loading';
  /** Resultado completo de useChatOrchestration — instanciado no page.tsx */
  orchestration: ReturnType<typeof useChatOrchestration>;
  /** Resultado completo de useAttachments — instanciado no page.tsx */
  attachments: ReturnType<typeof useAttachments>;
  /** Modo de análise unificado (substitui searchLimit + synthesisMode) */
  analysisMode?: AnalysisMode;
  onAnalysisModeChange?: (m: AnalysisMode) => void;
  /** Modelo de IA — selector compacto no ChatInputBar */
  modelId?: ModelValue;
  onModelChange?: (m: ModelValue) => void;
  /** Abre modal de login — recebe o texto pendente para retomar após login */
  onShowLoginModal?: (pendingText?: string) => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ChatView({
  userName,
  authStatus,
  orchestration,
  attachments,
  analysisMode = 'auto',
  onAnalysisModeChange,
  modelId,
  onModelChange,
  onShowLoginModal,
}: ChatViewProps) {
  const {
    displayMessages,
    sendMessage,
    stop,
    isLoading,
    chatId,
    activeQueryId,
    handleExecuteSearch,
    handleCancelSearch,
    executedProposalIds,
    runningSearches,
    articles,
    queryGroups,
    hasZeroResults,
    isSearchRunning,
    isSynthesisRunning,
    realtimeStatus,
    suggestionChips,
    clearSuggestionChips,
    // P-StatusBar: status da query ativa no DB (done/needs_refinement/processing/etc.)
    queryStatus,
  } = orchestration;

  // ── Painel lateral de extrações ─────────────────────────────────────────
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { setOpen: setSidebarOpen, isMobile } = useSidebar();
  // usePanelRef é a API imperativa do react-resizable-panels v4
  const mainPanelRef = usePanelRef();
  const extractionsPanelRef = usePanelRef();

  // Auto-abre quando chegam artigos pela primeira vez
  const { hasArticles } = orchestration;
  useEffect(() => {
    if (hasArticles && !isPanelOpen) {
      if (!isMobile) {
        setIsPanelOpen(true);
        // Recolhe a sidebar para dar espaço ao painel do acervo (só em desktop)
        setSidebarOpen(false);
        // Duplo rAF garante que o painel já está no DOM antes do expand
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            extractionsPanelRef.current?.expand();
            mainPanelRef.current?.resize('58');
          })
        );
      }
      // No mobile, deixamos colapsado por padrão conforme requisição
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasArticles, isMobile]);

  // ── Scroll ───────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Scroll instantâneo — usado no auto-scroll ao chegar mensagens novas
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Scroll suave — usado somente no botão manual "Rolar para baixo"
  const scrollToBottomSmooth = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // Scroll automático quando chegam mensagens novas
  useEffect(() => {
    if (displayMessages.length > 0) scrollToBottom();
  }, [displayMessages.length, scrollToBottom]);

  // Detecta distância do fundo para exibir botão de scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      setShowScrollButton(el.scrollHeight - el.scrollTop - el.clientHeight > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ── Highlighted row (G-03 — sincroniza com ExtractionsPanel) ─────────────
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null);

  // ── Input ────────────────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput(e.target.value),
    []
  );

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>) => {
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
      // Fase C (segurança): strip do prefixo reservado [SISTEMA] — previne injeção de instruções
      const safeText = input.replace(/^\[SISTEMA\]/gi, '').trim();
      if (!safeText) return;
      clearSuggestionChips();
      sendMessage({ text: safeText });
      setInput('');
      attachments.clearChips();
    },
    [authStatus, input, onShowLoginModal, sendMessage, clearSuggestionChips, attachments]
  );

  // ── Chips de sugestão rápida ─────────────────────────────────────────────
  const chipsList = useMemo(() => suggestionChips ?? [], [suggestionChips]);

  // Fase 3 (P-UI): jornada unificada de busca — agrega proposals de todas as mensagens
  const searchJourney = useMemo<SearchAttempt[]>(() => {
    const result: SearchAttempt[] = [];
    for (const msg of displayMessages) {
      if (msg.role !== 'assistant') continue;
      const parts = (msg.parts ?? []) as any[];
      for (const part of parts) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        const toolName = getToolOrDynamicToolName(part);
        if (
          toolName !== 'propose_search_sol_database' &&
          toolName !== 'propose_search_global_database'
        )
          continue;
        const { state } = part;
        if (!['output-available', 'input-available', 'input-streaming'].includes(state)) continue;
        const output = (part as any).output as Record<string, any> | undefined;
        const input = (part as any).input as Record<string, any> | undefined;
        if (toolName === 'propose_search_sol_database') {
          const queries: string[] | undefined = output?.queries ?? input?.queries;
          if (!queries?.length) continue;
          const queryId: string | undefined = output?.query_id;
          result.push({
            type: 'sol',
            toolCallId: part.toolCallId,
            queryId,
            queries,
            isExecuted: queryId ? (executedProposalIds?.has(queryId) ?? false) : false,
            isRunning: queryId ? (runningSearches?.has(queryId) ?? false) : false,
          });
        } else {
          const query: string | undefined = output?.query ?? input?.query;
          if (!query) continue;
          const queryId: string | undefined = output?.query_id;
          result.push({
            type: 'global',
            toolCallId: part.toolCallId,
            queryId,
            query,
            isExecuted: queryId ? (executedProposalIds?.has(queryId) ?? false) : false,
            isRunning: queryId ? (runningSearches?.has(queryId) ?? false) : false,
          });
        }
      }
    }
    return result;
  }, [displayMessages, executedProposalIds, runningSearches]);
  const handleSuggestionClick = useCallback((text: string) => setInput(text), []);

  // ── Navegação no histórico de queries ────────────────────────────────────
  const handleSelectQuery = useCallback((queryId: string) => {
    const el = document.querySelector(`[data-query-id="${queryId}"]`) as HTMLElement;
    if (el && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: el.offsetTop - 24,
        behavior: 'smooth',
      });
    }
  }, []);

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* ── Painel principal ── */}
        <ResizablePanel
          panelRef={mainPanelRef}
          defaultSize={100}
          minSize={30}
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ transition: 'flex 380ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Histórico de queries */}
            {queryGroups.length > 0 && (
              <QueryHistoryBar
                groups={queryGroups}
                activeQueryId={activeQueryId}
                onSelectQuery={handleSelectQuery}
              />
            )}

            {/* Lista de mensagens */}
            <div
              ref={scrollContainerRef}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-6"
            >
              <div className="mx-auto max-w-4xl space-y-4 px-4">
                {displayMessages.map((msg) => (
                  <ChatMessageItem
                    key={msg.id}
                    m={msg}
                    setHighlightedRow={setHighlightedRow}
                    articles={articles}
                    isStreaming={
                      isLoading && msg.id === displayMessages.at(-1)?.id && msg.role === 'assistant'
                    }
                    userName={userName}
                    onExecuteSearch={handleExecuteSearch}
                    onCancelSearch={handleCancelSearch}
                    executedProposalIds={executedProposalIds}
                    runningSearches={runningSearches}
                    chatId={chatId}
                    searchJourney={searchJourney}
                  />
                ))}
                {isLoading && displayMessages.at(-1)?.role !== 'assistant' && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Botão de scroll para baixo — sempre renderizado, visibilidade via CSS */}
            <button
              onClick={scrollToBottomSmooth}
              className={`group/scroll border-border/30 bg-background/40 hover:bg-background/80 absolute bottom-38 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0 rounded-full border px-3 py-2 shadow-md backdrop-blur-md transition-all duration-300 ${
                showScrollButton
                  ? 'translate-y-0 opacity-100'
                  : 'pointer-events-none translate-y-2 opacity-0'
              }`}
              aria-label="Rolar para o fim"
            >
              <ChevronsDown className="text-foreground/60 group-hover/scroll:text-foreground h-4 w-4 shrink-0 transition-colors duration-300" />
              <span className="text-foreground/80 max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-300 group-hover/scroll:max-w-48">
                Rolar para o fim
              </span>
            </button>

            {/* Barra de status global do pipeline — P-StatusBar */}
            <PipelineStatusBar
              isSearchRunning={isSearchRunning}
              articles={articles}
              activeQueryId={activeQueryId}
              queryStatus={queryStatus}
              isSynthesisRunning={isSynthesisRunning}
              hasZeroResults={hasZeroResults}
            />

            {/* Barra de input */}
            <div>
              <ChatInputBar
                input={input}
                onInputChange={handleInputChange}
                onSubmit={handleSubmit}
                showAbortButton={isLoading}
                onAbort={stop}
                suggestionChips={chipsList}
                onSuggestionClick={handleSuggestionClick}
                attachments={attachments}
                analysisMode={analysisMode}
                onAnalysisModeChange={onAnalysisModeChange}
                modelId={modelId}
                onModelChange={onModelChange}
              />
            </div>
          </div>
        </ResizablePanel>

        {/* ── Painel lateral de extrações ── sempre montado quando há artigos ── */}
        {hasArticles && !isMobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              panelRef={extractionsPanelRef}
              defaultSize="0"
              minSize="35"
              maxSize="65"
              collapsible
              collapsedSize="0"
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
              style={{ transition: 'flex 380ms cubic-bezier(0.16, 1, 0.3, 1)' }}
              onResize={(size) => setIsPanelOpen(size.asPercentage > 1)}
            >
              <ExtractionsPanel
                articles={articles}
                activeQueryId={activeQueryId}
                highlightedRow={highlightedRow}
                hasZeroResults={hasZeroResults}
                isSearchRunning={isSearchRunning}
                realtimeStatus={realtimeStatus}
                onCollapse={() => extractionsPanelRef.current?.collapse()}
                onCancelSearch={handleCancelSearch}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* ── Sheet para Mobile: Painel lateral vira drawer ── */}
      {hasArticles && isMobile && (
        <Sheet open={isPanelOpen} onOpenChange={setIsPanelOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="disable-sheet-focus flex w-[90vw] flex-col border-l p-0 sm:w-[540px]"
          >
            {/* Ocultando title/desc para acessibilidade mas sem visual bagunçado */}
            <div className="sr-only">
              <SheetTitle>Acervo de Extração</SheetTitle>
              <SheetDescription>Resultados e PDFs extraídos da busca atual.</SheetDescription>
            </div>
            <ExtractionsPanel
              articles={articles}
              activeQueryId={activeQueryId}
              highlightedRow={highlightedRow}
              hasZeroResults={hasZeroResults}
              isSearchRunning={isSearchRunning}
              realtimeStatus={realtimeStatus}
              onCollapse={() => setIsPanelOpen(false)}
              onCancelSearch={handleCancelSearch}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* ── Aba lateral para re-abrir o painel do acervo — sempre no DOM quando há artigos, visibilidade via CSS ── */}
      {hasArticles && (
        <button
          onClick={() => {
            setIsPanelOpen(true);
            if (!isMobile) {
              extractionsPanelRef.current?.expand();
              mainPanelRef.current?.resize('58');
            }
          }}
          className={`group/tab border-border/60 bg-background hover:bg-muted hover:border-primary/40 absolute top-1/2 right-0 z-20 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-2 rounded-l-xl border border-r-0 px-2.5 py-4 shadow-md transition-all duration-300 ${
            !isPanelOpen
              ? 'translate-x-0 opacity-100'
              : 'pointer-events-none translate-x-4 opacity-0'
          }`}
          aria-label="Abrir painel do acervo"
        >
          <ChevronLeft className="text-muted-foreground group-hover/tab:text-primary h-3.5 w-3.5 shrink-0 transition-colors" />
          <BookOpen className="text-muted-foreground group-hover/tab:text-primary h-4 w-4 shrink-0 transition-colors" />
          <span className="text-muted-foreground group-hover/tab:text-primary rotate-180 text-[10px] font-medium tracking-widest uppercase transition-colors [writing-mode:vertical-rl]">
            Acervo
          </span>
        </button>
      )}

      {/* ── Dialog de anexo — fora do ResizablePanelGroup para não interferir no layout ── */}
      <Dialog
        open={attachments.isAttachDialogOpen}
        onOpenChange={attachments.setIsAttachDialogOpen}
      >
        <DialogContent className="sm:max-w-130">
          <DialogHeader>
            <DialogTitle>Adicionar Referência</DialogTitle>
            <DialogDescription>
              Faça upload de um PDF ou adicione um DOI para incluir no contexto da conversa.
            </DialogDescription>
          </DialogHeader>
          <AttachContent
            variant="full"
            uploadState={attachments.uploadState}
            doiInput={attachments.doiInput}
            doiState={attachments.doiState}
            isDropZoneActive={attachments.isDropZoneActive}
            onDropZoneDragOver={(e) => {
              e.stopPropagation();
              attachments.setIsDropZoneActive(true);
            }}
            onDropZoneDragLeave={() => attachments.setIsDropZoneActive(false)}
            onDropZoneDrop={(e) => {
              attachments.setIsDropZoneActive(false);
              Array.from(e.dataTransfer.files)
                .filter((f) => f.type === 'application/pdf')
                .forEach((f) => attachments.submitPdfFile(f));
              attachments.setIsAttachDialogOpen(false);
            }}
            onDropZoneClick={() => attachments.fileInputRef.current?.click()}
            onDoiChange={(val) => attachments.setDoiInput(val)}
            onDoiSubmit={attachments.handleDoiSubmit}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

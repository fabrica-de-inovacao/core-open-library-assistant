'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense, useMemo } from 'react';
import { type UIMessage, isToolOrDynamicToolUIPart } from 'ai';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TextareaAutosize from 'react-textarea-autosize';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Send,
  Square,
  Loader2,
  Library,
  Cpu,
  PanelRightOpen,
  Paperclip,
  Hash,
  Clock,
  X,
  ChevronsDown,
  TrendingUp,
  Flame,
  ArrowUp,
  Globe,
  Info,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession, signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { useSearchParams, useParams } from 'next/navigation';
import { ChatMessageItem, TypingIndicator } from '@/components/workspace/ChatMessageItem';
import { ExtractionsPanel } from '@/components/workspace/ExtractionsPanel';
import { QueryHistoryBar } from '@/components/workspace/QueryHistoryBar';
import { ShareDialog } from '@/components/ShareDialog';
import { useChatOrchestration } from '@/hooks/useChatOrchestration';
import type { SuggestionChip } from '@/hooks/useChatOrchestration';
import type { TrendingTopic } from '@/app/api/trending-topics/route';

// P-22: Modelos disponíveis para seleção (Google Gemini)
const MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Equilibrado (padrão)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Alta qualidade' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Econômico' },
  // Lite preview — economiza tokens durante testes
  {
    value: 'gemini-2.5-flash-lite-preview-04-17',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Testes (lite)',
  },
] as const;

type ModelValue = (typeof MODEL_OPTIONS)[number]['value'];
const DEFAULT_MODEL: ModelValue = 'gemini-2.5-flash';

export default function WorkspacePage({ initialMessages }: { initialMessages?: UIMessage[] }) {
  return (
    <Suspense fallback={<div>Loading workspace...</div>}>
      <WorkspaceContent initialMessages={initialMessages} />
    </Suspense>
  );
}

/**
 * WorkspaceContent — componente responsivo do workspace.
 * P-06: Lógica de orquestração extraída para useChatOrchestration hook.
 * Este componente foca apenas na renderização e interação do usuário.
 */
function WorkspaceContent({ initialMessages }: { initialMessages?: UIMessage[] }) {
  const searchParams = useSearchParams();
  const params = useParams();
  const searchParamQueryId = searchParams?.get('q');
  // Rota /workspace/chat/[chatId] — o param chama-se "chatId", não "id"
  const pathQueryId = (params?.chatId ?? params?.id) as string | undefined;
  const urlQueryId = pathQueryId || searchParamQueryId;

  const [highlightedRow, setHighlightedRowState] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [input, setInput] = useState('');
  // Fase 3 (P-abort): mensagem digitada enquanto o assistente está processando
  const [pendingMessage, setPendingMessage] = useState('');
  const wasLoadingRef = useRef(false);
  // Fase 3 (P-PDF): upload de PDF pelo usuário
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Dialog de anexar (PDF ou DOI) — usado no toolbar do chat
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  // Popover flutuante de anexar — usado na home toolbar
  const [showAttachPopover, setShowAttachPopover] = useState(false);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Chips de anexo visíveis acima do input (múltiplos)
  const [attachmentChips, setAttachmentChips] = useState<
    { id: string; name: string; state: 'uploading' | 'done' | 'error'; type: 'pdf' | 'doi' }[]
  >([]);
  // Campo DOI dentro do dialog
  const [doiInput, setDoiInput] = useState('');
  const [doiState, setDoiState] = useState<'idle' | 'loading' | 'error'>('idle');

  // P-22: Seleção de modelo — persiste em localStorage
  const [modelId, setModelId] = useState<ModelValue>(() => {
    if (typeof window === 'undefined') return DEFAULT_MODEL;
    return (localStorage.getItem('sol-model') as ModelValue | null) ?? DEFAULT_MODEL;
  });
  useEffect(() => {
    localStorage.setItem('sol-model', modelId);
  }, [modelId]);

  // Fase 8 (P-trending): tópicos em alta via OpenAlex
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  useEffect(() => {
    const isHome = messages.length === 0 && !activeQueryId;
    if (!isHome) return;
    fetch('/api/trending-topics')
      .then((r) => r.json() as Promise<{ topics: TrendingTopic[] }>)
      .then(({ topics }) => setTrendingTopics(topics ?? []))
      .catch(() => setTrendingTopics([]))
      .finally(() => setTrendingLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setHighlightedRow = useCallback((value: string | null) => {
    setHighlightedRowState(value);
  }, []);

  const { data: session, status: authStatus } = useSession();
  const userName = session?.user?.name;

  // P-06: toda a lógica de chat/busca/artigos está no hook
  const {
    messages,
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
    displayArticles,
    panelQueryId,
    hasArticles,
    queryGroups,
    realtimeStatus,
    hasZeroResults,
    isSearchRunning,
    addWatchedQueryId,
    refreshArticles,
    // Fase 3 (P-chips)
    suggestionChips,
    clearSuggestionChips,
  } = useChatOrchestration({
    urlQueryId: urlQueryId ?? undefined,
    initialMessages,
    authStatus,
    modelId,
  });

  // P-23: query selecionada pelo histórico (sobrescreve panelQueryId para o painel direito)
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);

  // Fase 3 (P-PDF): remove artigo enviado pelo utilizador do acervo
  const handleDeleteArticle = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        console.error('[workspace] Falha ao remover artigo:', data.error ?? res.status);
        return;
      }
      await refreshArticles();
    },
    [refreshArticles]
  );
  // Reset seleção manual quando uma nova query se torna ativa (nova busca executada)
  useEffect(() => {
    setSelectedQueryId(null);
  }, [activeQueryId]);

  // Painel direito colapsável
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  // Reseta colapso quando não há mais artigos/busca ativa
  useEffect(() => {
    if (!hasArticles && !isSearchRunning) setIsPanelCollapsed(false);
  }, [hasArticles, isSearchRunning]);

  // Auto-colapsa a sidebar apenas na primeira vez que o painel de extração aparece.
  // Após isso o utilizador pode reabrir a sidebar livremente.
  const { setOpen: setSidebarOpen } = useSidebar();
  const hasPanelRef = useRef(false);
  useEffect(() => {
    const panelActive = hasArticles || isSearchRunning;
    if (panelActive && !hasPanelRef.current) {
      setSidebarOpen(false);
      hasPanelRef.current = true;
    }
    if (!panelActive) {
      hasPanelRef.current = false;
    }
  }, [hasArticles, isSearchRunning, setSidebarOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sozinho → envia; Shift+Enter → nova linha
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!input.trim()) return;
    if (authStatus === 'unauthenticated') {
      setShowLoginModal(true);
      return;
    }
    // Fase 3 (P-chips): qualquer mensagem manual descarta chips pendentes
    clearSuggestionChips();
    // Fase 3 (P-abort): se o assistente ainda está processando, enfileira a mensagem.
    // Se já existe uma na fila, ignora (não sobrescreve).
    if (isLoading) {
      if (!pendingMessage) {
        setPendingMessage(input);
        setInput('');
      }
      return;
    }
    sendMessage({ text: input });
    setInput('');
    setAttachmentChips([]);
  };

  // Fase 3 (P-abort): tool em execução mas SDK reportou 'idle' entre passos multi-step
  const isToolPending = useMemo(
    () =>
      messages.some((m) =>
        m.parts?.some(
          (p) =>
            isToolOrDynamicToolUIPart(p) && (p as { state?: string }).state !== 'output-available'
        )
      ),
    [messages]
  );
  // Botão de abort aparece quando o SDK está ativo OU quando há tool ainda executando
  const showAbortButton = isLoading || isToolPending;

  const handleAbort = () => {
    stop();
    // Descarta qualquer mensagem enfileirada — não deve ser enviada após abort intencional.
    setPendingMessage('');
  };

  // Fase 3 (P-abort): quando o assistente termina (ou é abortado), envia mensagem pendente.
  // Usa showAbortButton para não disparar no gap idle entre passos multi-step da tool.
  useEffect(() => {
    if (wasLoadingRef.current && !showAbortButton && pendingMessage) {
      sendMessage({ text: pendingMessage });
      setPendingMessage('');
    }
    wasLoadingRef.current = showAbortButton;
  }, [showAbortButton]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fase 3 (P-PDF): envia PDF para /api/upload-pdf e dispara pipeline Inngest
  const submitPdfFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Apenas arquivos PDF são suportados.');
      return;
    }
    const chipId = crypto.randomUUID();
    setAttachmentChips((prev) => [
      ...prev,
      { id: chipId, name: file.name, state: 'uploading', type: 'pdf' },
    ]);
    setUploadState('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('chatId', chatId);
      const response = await fetch('/api/upload-pdf', { method: 'POST', body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as { queryId?: string; title?: string };
      if (data.queryId) addWatchedQueryId(data.queryId);
      await refreshArticles();
      setUploadState('idle');
      setShowAttachDialog(false);
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === chipId ? { ...c, state: 'done' } : c))
      );
    } catch (err) {
      setUploadState('error');
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === chipId ? { ...c, state: 'error' } : c))
      );
      toast.error(`Falha no upload: ${(err as Error).message}`, { duration: 4000 });
      setTimeout(() => setUploadState('idle'), 4000);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    files.forEach((file) => {
      submitPdfFile(file);
    });
    setShowAttachPopover(false);
  };

  // Fase 3 (P-DOI): adiciona artigo pelo DOI via CrossRef
  const handleDoiSubmit = async () => {
    // Normaliza: aceita URL completa (https://doi.org/10.xxx) ou DOI nu (10.xxx)
    const raw = doiInput.trim();
    const doi = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
    if (!doi || !chatId) return;
    if (doiState === 'loading') return;
    setDoiState('loading');
    const doiChipId = crypto.randomUUID();
    setAttachmentChips((prev) => [
      ...prev,
      { id: doiChipId, name: doi, state: 'uploading', type: 'doi' },
    ]);
    setShowAttachPopover(false);
    try {
      const response = await fetch('/api/add-by-doi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doi, chatId }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as { title?: string; queryId?: string };
      // Fase 3 (P-DOI): inscreve realtime e atualiza painel
      if (data.queryId) addWatchedQueryId(data.queryId);
      await refreshArticles();
      setDoiState('idle');
      setDoiInput('');
      setShowAttachDialog(false);
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === doiChipId ? { ...c, state: 'done', name: data.title ?? doi } : c))
      );
      toast.success(data.title ? `"${data.title}" adicionado!` : 'Artigo adicionado ao acervo!', {
        duration: 3000,
      });
    } catch (err) {
      setDoiState('error');
      setAttachmentChips((prev) =>
        prev.map((c) => (c.id === doiChipId ? { ...c, state: 'error' } : c))
      );
      toast.error(`DOI inválido ou não encontrado: ${(err as Error).message}`, { duration: 4000 });
      setTimeout(() => setDoiState('idle'), 4000);
    }
  };

  // Drag & drop — detecta arquivos arrastados para a janela inteira
  const handlePageDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };
  const handlePageDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const handlePageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files)
      .filter((f) => f.type === 'application/pdf')
      .forEach((f) => submitPdfFile(f));
  };

  // P-08: Auto-scroll inteligente
  // - Durante streaming: scroll instantâneo (sem smooth, sem lag)
  // - Ao enviar/receber mensagem: scroll suave
  // - Se o utilizador rolou para cima manualmente: não força scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const userScrolledUpRef = useRef(false);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const threshold = 80; // px de tolerância
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
    userScrolledUpRef.current = !atBottom;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    setIsAtBottom(true);
    userScrolledUpRef.current = false;
  }, []);

  // Scroll ao receber novas mensagens (não durante streaming ativo — o outro effect cuida disso)
  useEffect(() => {
    if (!userScrolledUpRef.current) scrollToBottom(false);
  }, [displayMessages.length, scrollToBottom]);

  // Quando o painel de acervo abre/fecha, o ResizablePanelGroup remonta (muda de key),
  // desmontando o chatScrollRef e zerando o scrollTop. Força scroll ao final após o remount.
  useEffect(() => {
    userScrolledUpRef.current = false;
    const id = setTimeout(() => scrollToBottom(false), 60);
    return () => clearTimeout(id);
  }, [hasArticles, isSearchRunning, isPanelCollapsed, scrollToBottom]);

  // Scroll contínuo durante streaming (a cada chunk)
  useEffect(() => {
    if (isLoading && !userScrolledUpRef.current) scrollToBottom(false);
  });

  return (
    <div
      className="bg-background text-foreground flex h-screen w-full flex-col overflow-hidden font-sans"
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {/* Overlay de drag & drop */}
      {isDragging && (
        <div className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
          <div className="border-primary bg-primary/5 rounded-2xl border-2 border-dashed px-12 py-8 text-center shadow-xl">
            <Paperclip className="text-primary mx-auto mb-2 h-8 w-8" />
            <p className="text-primary text-base font-semibold">Solte para adicionar ao acervo</p>
            <p className="text-muted-foreground mt-1 text-xs">Apenas arquivos PDF</p>
          </div>
        </div>
      )}
      {/* Top Header — sem divisor; model/share só aparecem em sessão ativa */}
      <header className="bg-background/95 flex h-14 shrink-0 items-center justify-between px-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {/* Trigger visível apenas em mobile */}
          <SidebarTrigger className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors md:hidden" />
          <span className="text-muted-foreground/50 text-sm font-medium tracking-tight">
            {messages.length > 0 || activeQueryId ? 'Workspace' : ''}
          </span>
        </div>

        {/* Ações contextuais — só visíveis em sessão ativa (não na home) */}
        {(messages.length > 0 || activeQueryId) && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Cpu className="text-muted-foreground h-3.5 w-3.5" />
              <Select value={modelId} onValueChange={(val) => setModelId(val as ModelValue)}>
                <SelectTrigger className="h-7 w-[160px] text-xs">
                  <SelectValue placeholder="Modelo" />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      <span className="font-medium">{m.label}</span>
                      <span className="text-muted-foreground ml-1">— {m.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ShareDialog chatId={chatId} />
            {isPanelCollapsed && (hasArticles || isSearchRunning) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPanelCollapsed(false)}
                title="Abrir acervo de extração"
                className="h-7 gap-1.5 text-xs"
              >
                <PanelRightOpen className="size-3.5" />
                Acervo
              </Button>
            )}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      {messages.length === 0 && !activeQueryId ? (
        /* ── Hero / Home ────────────────────────────────────────────────── */
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
                Só descreva o que você quer pesquisar. A SOL encontra, lê e organiza a literatura
                científica ibero-americana mais relevante para você.
              </p>
            </div>

            {/* ── Input principal com toolbar ── */}
            <form onSubmit={handleSubmit}>
              <div className="border-border bg-card focus-within:border-primary/60 focus-within:ring-primary/20 overflow-hidden rounded-2xl border shadow-lg transition-all focus-within:ring-2">
                {/* Chips de anexos */}
                {attachmentChips.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-top-1 flex flex-wrap gap-2 px-4 pt-3 pb-1 duration-200">
                    {attachmentChips.map((chip) => (
                      <div
                        key={chip.id}
                        className="bg-muted/80 border-border/30 relative flex h-[76px] w-[90px] flex-col justify-between overflow-hidden rounded-xl border p-2.5"
                      >
                        {/* X */}
                        <button
                          type="button"
                          onClick={() =>
                            setAttachmentChips((prev) => prev.filter((c) => c.id !== chip.id))
                          }
                          className="bg-background border-border/50 hover:bg-muted absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full border shadow-sm transition-colors"
                        >
                          <X className="h-2 w-2" />
                        </button>
                        {/* Filename */}
                        <span className="mt-0.5 line-clamp-2 pr-3 text-[10px] leading-snug font-medium">
                          {chip.name.replace(/\.pdf$/i, '')}
                        </span>
                        {/* Badge */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            {chip.state === 'uploading' ? (
                              <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
                            ) : chip.state === 'done' ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            ) : (
                              <span className="text-destructive text-[9px] font-bold">ERR</span>
                            )}
                          </div>
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white ${
                              chip.type === 'doi' ? 'bg-blue-600' : 'bg-red-600'
                            }`}
                          >
                            {chip.type === 'doi' ? 'DOI' : 'PDF'}
                          </span>
                        </div>
                      </div>
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
                <div className="border-border/40 flex items-center gap-1 border-t px-3 py-2">
                  {/* Popover flutuante — Anexar PDF ou DOI */}
                  <Popover
                    open={showAttachPopover}
                    onOpenChange={(open) => {
                      setShowAttachPopover(open);
                      if (!open) {
                        setDoiInput('');
                        setDoiState('idle');
                        setIsDropZoneActive(false);
                      }
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

                      {/* Drop zone compacta */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDropZoneActive(true);
                        }}
                        onDragLeave={() => setIsDropZoneActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDropZoneActive(false);
                          Array.from(e.dataTransfer.files)
                            .filter((f) => f.type === 'application/pdf')
                            .forEach((f) => submitPdfFile(f));
                          setShowAttachPopover(false);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        className={`group cursor-pointer rounded-lg border-2 border-dashed p-5 text-center transition-all duration-200 ${
                          isDropZoneActive
                            ? 'border-primary bg-primary/8 scale-[1.01]'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        }`}
                      >
                        {uploadState === 'uploading' ? (
                          <>
                            <Loader2 className="text-primary mx-auto mb-2 h-6 w-6 animate-spin" />
                            <p className="text-primary text-xs font-medium">Processando PDF…</p>
                          </>
                        ) : isDropZoneActive ? (
                          <>
                            <FileText className="text-primary mx-auto mb-2 h-6 w-6" />
                            <p className="text-primary text-xs font-semibold">Solte para anexar</p>
                          </>
                        ) : (
                          <>
                            <div className="bg-muted group-hover:bg-primary/10 mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg transition-colors">
                              <Paperclip className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
                            </div>
                            <p className="text-xs font-medium">Arraste um PDF aqui</p>
                            <p className="text-muted-foreground mt-0.5 text-[11px]">
                              ou clique para selecionar
                            </p>
                          </>
                        )}
                      </div>

                      {/* Separador "ou via DOI" */}
                      <div className="relative my-3 flex items-center gap-2">
                        <div className="flex-1 border-t" />
                        <span className="text-muted-foreground text-[11px]">ou via DOI</span>
                        <div className="flex-1 border-t" />
                      </div>

                      {/* Campo DOI */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Hash className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
                          <Input
                            value={doiInput}
                            onChange={(e) => setDoiInput(e.target.value)}
                            placeholder="10.1234/exemplo.2024"
                            className="pl-8 font-mono text-xs"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleDoiSubmit();
                            }}
                            disabled={doiState === 'loading'}
                          />
                        </div>
                        <Button
                          onClick={handleDoiSubmit}
                          disabled={doiState === 'loading' || !doiInput.trim()}
                          size="sm"
                          className="shrink-0"
                        >
                          {doiState === 'loading' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            'Adicionar'
                          )}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Separador visual */}
                  <div className="bg-border/40 mx-1 h-4 w-px" />

                  {/* Indicador de cobertura */}
                  <span className="text-muted-foreground/50 flex items-center gap-1 text-[11px]">
                    <Globe className="h-3 w-3" />
                    SOL · DOAJ · OpenAlex · Redalyc
                  </span>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Botão enviar */}
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
                </div>
              </div>
            </form>

            {/* ── Trending Topics — marquee horizontal ── */}
            <div className="mt-8">
              <div className="mb-3 flex items-center gap-1.5">
                <Flame className="text-sol-amber h-3.5 w-3.5" />
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Tópicos em alta na computação
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground/30 hover:text-muted-foreground flex items-center transition-colors"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-center text-xs">
                    Sugestões baseadas nos tópicos em alta de Ciência da Computação no OpenAlex e
                    nas pesquisas mais recorrentes dos usuários da SOL.
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* 3 faixas com máscara de fade nas bordas */}
              <div
                className="marquee-container relative flex flex-col gap-2 overflow-hidden"
                style={{
                  maskImage:
                    'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
                  WebkitMaskImage:
                    'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
                }}
              >
                {trendingLoading ? (
                  /* Skeleton — 3 linhas pulsantes */
                  <>
                    {[
                      [5, 4, 3, 4, 5],
                      [4, 5, 3, 4],
                      [3, 5, 4, 3, 5],
                    ].map((widths, ri) => (
                      <div key={ri} className="flex gap-2.5 py-0.5">
                        {widths.map((w, i) => (
                          <div
                            key={i}
                            className="bg-muted h-7 shrink-0 animate-pulse rounded-full"
                            style={{ width: `${w * 22}px` }}
                          />
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  /* Cada linha recebe um slice diferente dos tópicos,
                     duplicado para o loop infinito sem corte */
                  (['marquee-track', 'marquee-track-reverse', 'marquee-track-slow'] as const).map(
                    (cls, ri) => {
                      const slices = [
                        trendingTopics.slice(0, 4),
                        trendingTopics.slice(4, 7),
                        trendingTopics.slice(7),
                      ];
                      const row = slices[ri] ?? slices[0];
                      return (
                        <div key={ri} className={`${cls} flex w-max gap-2.5 py-0.5`}>
                          {[...row, ...row].map((topic, idx) => (
                            <button
                              key={`${topic.id}-${ri}-${idx}`}
                              type="button"
                              onClick={() => {
                                setInput(topic.label);
                                if (authStatus === 'unauthenticated') setShowLoginModal(true);
                              }}
                              className="group border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-primary flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 transition-all focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <TrendingUp className="text-muted-foreground/30 group-hover:text-primary h-3 w-3 shrink-0 transition-colors" />
                              <span className="text-foreground/60 group-hover:text-foreground text-[12.5px] font-medium whitespace-nowrap transition-colors">
                                {topic.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    }
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          key={String(!!(hasArticles || isSearchRunning) && !isPanelCollapsed)}
          orientation="horizontal"
          className="w-full flex-1"
        >
          {/* LEFT PANEL: Chat */}
          <ResizablePanel
            defaultSize={(hasArticles || isSearchRunning) && !isPanelCollapsed ? 40 : 100}
            minSize={30}
            className={`bg-background relative flex flex-col ${!hasArticles ? 'border-border/50 mx-auto max-w-4xl border-x shadow-sm' : ''}`}
          >
            {/* P-23: Barra de histórico de queries — visível assim que houver artigos */}
            <QueryHistoryBar
              groups={queryGroups}
              activeQueryId={selectedQueryId ?? panelQueryId}
              onSelectQuery={(qId) => {
                setSelectedQueryId(qId);
              }}
            />
            <div
              ref={chatScrollRef}
              onScroll={handleChatScroll}
              className="relative min-h-0 flex-1 overflow-y-auto p-6"
            >
              <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-6">
                {displayMessages.map((m: UIMessage) => {
                  const isLastInTotal =
                    messages.length > 0 && m.id === messages[messages.length - 1].id;
                  const isStreaming = isLoading && isLastInTotal && m.role === 'assistant';

                  return (
                    <div
                      key={m.id}
                      className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500"
                    >
                      <ChatMessageItem
                        m={m}
                        setHighlightedRow={setHighlightedRow}
                        articles={displayArticles}
                        isStreaming={isStreaming}
                        userName={userName}
                        onExecuteSearch={handleExecuteSearch}
                        onCancelSearch={handleCancelSearch}
                        executedProposalIds={executedProposalIds}
                        runningSearches={runningSearches}
                      />
                    </div>
                  );
                })}
                {isLoading &&
                  displayMessages.length > 0 &&
                  displayMessages.at(-1)?.role === 'user' && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Botão scroll-to-bottom — flutua sobre o chat, fora do container de scroll */}
            {!isAtBottom && (
              <button
                onClick={() => scrollToBottom(true)}
                className="animate-in fade-in slide-in-from-bottom-2 bg-background/90 border-border text-muted-foreground hover:text-foreground hover:border-primary/40 absolute bottom-32 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-md backdrop-blur-sm transition-all duration-200 hover:shadow-lg"
                aria-label="Ir para o final do chat"
              >
                <ChevronsDown className="h-3.5 w-3.5" />
                Ir para o final
              </button>
            )}

            {/* Chat Input */}
            <div className="border-border/60 bg-background/95 border-t px-4 py-3 backdrop-blur-sm">
              {/* Fase 3 (P-abort): badge de mensagem na fila — estilo Cursor/Copilot */}
              {pendingMessage && (
                <div className="animate-in slide-in-from-bottom-2 fade-in mx-auto mb-2 flex max-w-2xl items-center gap-2 duration-200">
                  <div className="border-border/60 bg-muted/60 text-foreground/70 flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] shadow-sm backdrop-blur-sm">
                    <Clock className="text-muted-foreground h-3 w-3 shrink-0" />
                    <span className="text-muted-foreground shrink-0 font-medium">Na fila:</span>
                    <span className="min-w-0 truncate italic">&ldquo;{pendingMessage}&rdquo;</span>
                    <button
                      type="button"
                      onClick={() => setPendingMessage('')}
                      className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded p-0.5 transition-colors"
                      title="Cancelar mensagem da fila"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
              {/* Fase 3 (P-chips): sugestões rápidas após needs_refinement */}
              {suggestionChips && suggestionChips.length > 0 && (
                <div className="animate-in slide-in-from-bottom-2 fade-in mx-auto mb-2 max-w-2xl duration-300">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground shrink-0 text-[11px] font-medium">
                      O que fazer agora?
                    </span>
                    {suggestionChips.map((chip: SuggestionChip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          clearSuggestionChips();
                          sendMessage({ text: chip.message });
                        }}
                        className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/60 focus-visible:ring-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-all focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span>{chip.icon}</span>
                        {chip.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={clearSuggestionChips}
                      className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded p-0.5 transition-colors"
                      title="Fechar sugestões"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
              <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
                <div className="border-border bg-card focus-within:border-primary focus-within:ring-primary relative rounded-2xl border shadow-sm transition-all focus-within:ring-1">
                  {/* Chips de anexos */}
                  {attachmentChips.length > 0 && (
                    <div className="animate-in fade-in slide-in-from-top-1 flex flex-wrap gap-2 border-b px-3 py-2.5 duration-200">
                      {attachmentChips.map((chip) => (
                        <div
                          key={chip.id}
                          className="bg-muted/80 border-border/30 relative flex h-[76px] w-[90px] flex-col justify-between overflow-hidden rounded-xl border p-2.5"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setAttachmentChips((prev) => prev.filter((c) => c.id !== chip.id))
                            }
                            className="bg-background border-border/50 hover:bg-muted absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full border shadow-sm transition-colors"
                          >
                            <X className="h-2 w-2" />
                          </button>
                          <span className="mt-0.5 line-clamp-2 pr-3 text-[10px] leading-snug font-medium">
                            {chip.name.replace(/\.pdf$/i, '')}
                          </span>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              {chip.state === 'uploading' ? (
                                <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
                              ) : chip.state === 'done' ? (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              ) : (
                                <span className="text-destructive text-[9px] font-bold">ERR</span>
                              )}
                            </div>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white ${
                                chip.type === 'doi' ? 'bg-blue-600' : 'bg-red-600'
                              }`}
                            >
                              {chip.type === 'doi' ? 'DOI' : 'PDF'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <TextareaAutosize
                    value={input}
                    onChange={handleInputChange}
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

                  {/* Fase 3 (P-PDF): botão anexar — abre dialog PDF/DOI */}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowAttachDialog(true)}
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

                  {/* Input oculto para seleção de PDF nativa */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                  />

                  {/* Botão enviar / abortar — canto inferior direito */}
                  {showAbortButton ? (
                    <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
                      {/* Anel giratório externo — vermelho */}
                      <div className="pointer-events-none absolute inset-0 animate-spin rounded-xl border-2 border-rose-500/20 border-t-rose-500/70" />
                      <Button
                        type="button"
                        size="icon"
                        onClick={handleAbort}
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
                      disabled={!input.trim()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary absolute top-1/2 right-1.5 h-8 w-8 -translate-y-1/2 rounded-xl shadow-sm transition-all focus-visible:ring-2 disabled:opacity-40"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </form>

              {/* Linha de crédito / disclaimer */}
              <p className="text-muted-foreground/40 mt-2 text-center text-[10px]">
                SOL pode cometer erros. Verifique as fontes no acervo.
              </p>
            </div>
          </ResizablePanel>

          {(hasArticles || isSearchRunning) && !isPanelCollapsed && (
            <>
              <ResizableHandle
                withHandle
                className="bg-border hover:bg-primary/40 w-1 transition-colors"
              />
              <ResizablePanel
                defaultSize={60}
                minSize={30}
                className="animate-in fade-in slide-in-from-right-4 fill-mode-both duration-700"
              >
                <ExtractionsPanel
                  articles={displayArticles}
                  activeQueryId={selectedQueryId ?? panelQueryId}
                  highlightedRow={highlightedRow}
                  hasZeroResults={hasZeroResults}
                  isSearchRunning={isSearchRunning}
                  realtimeStatus={realtimeStatus}
                  onCollapse={() => setIsPanelCollapsed(true)}
                  onDeleteArticle={handleDeleteArticle}
                  onCancelSearch={handleCancelSearch}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}

      {/* Dialog de Anexar — PDF ou DOI */}
      <Dialog
        open={showAttachDialog}
        onOpenChange={(open) => {
          setShowAttachDialog(open);
          if (!open) {
            setDoiInput('');
            setDoiState('idle');
            setIsDropZoneActive(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar ao acervo</DialogTitle>
            <DialogDescription>
              Envie um PDF ou adicione pelo DOI para enriquecer o acervo desta sessão.
            </DialogDescription>
          </DialogHeader>

          {/* Drop zone de PDF */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDropZoneActive(true);
            }}
            onDragLeave={() => setIsDropZoneActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDropZoneActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) submitPdfFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDropZoneActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40 hover:bg-muted/40'
            }`}
          >
            {uploadState === 'uploading' ? (
              <>
                <Loader2 className="text-primary mx-auto mb-3 h-8 w-8 animate-spin" />
                <p className="text-primary text-sm font-medium">Extraindo conteúdo…</p>
              </>
            ) : (
              <>
                <Paperclip className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
                <p className="text-sm font-medium">Arraste um PDF ou clique para selecionar</p>
                <p className="text-muted-foreground mt-1 text-xs">Apenas arquivos .pdf</p>
              </>
            )}
          </div>

          {/* Separador "ou via DOI" */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t" />
            <span className="text-muted-foreground text-xs">ou via DOI</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Campo DOI */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Hash className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={doiInput}
                onChange={(e) => setDoiInput(e.target.value)}
                placeholder="10.1234/exemplo.2024"
                className="pl-9 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDoiSubmit();
                }}
                disabled={doiState === 'loading'}
              />
            </div>
            <Button
              onClick={handleDoiSubmit}
              disabled={doiState === 'loading' || !doiInput.trim()}
              className="shrink-0"
            >
              {doiState === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Adicionar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Login Modal */}
      <Dialog open={showLoginModal} onOpenChange={setShowLoginModal}>
        <DialogContent className="border-border bg-card overflow-hidden p-0 shadow-2xl sm:max-w-md">
          <div className="flex flex-col items-center justify-center p-8 text-center sm:p-10">
            <div className="bg-primary text-primary-foreground shadow-primary/20 mb-4 flex aspect-square size-12 items-center justify-center rounded-xl shadow-lg">
              <Library className="size-6" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-foreground mb-2 font-sans text-xl font-bold tracking-tight">
                SOL Open Library Assistant
              </DialogTitle>
              <DialogDescription className="text-muted-foreground mx-auto max-w-sm text-sm">
                Acesse para pesquisar e gerenciar suas revisões sistemáticas da literatura.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-8 w-full max-w-xs">
              <Button
                onClick={() => signIn('google', { redirectTo: '/workspace' })}
                className="border-border bg-background text-foreground hover:bg-accent focus-visible:ring-primary flex h-12 w-full items-center justify-center gap-3 rounded-full border text-base font-medium shadow-sm transition-all focus-visible:ring-2"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continuar com Google
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

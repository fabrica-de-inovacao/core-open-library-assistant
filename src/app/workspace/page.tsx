/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useEffect, useRef, useMemo, Suspense, useCallback } from 'react';
import { useChat } from 'ai/react';
import { Message } from 'ai';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Send,
  Loader2,
  Search,
  Database,
  Library,
  MoreVertical,
  Link as LinkIcon,
  Copy,
  Download,
  Flame,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSession, signIn } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSearchParams, useParams, usePathname } from 'next/navigation';

export default function WorkspacePage({ initialMessages }: { initialMessages?: Message[] }) {
  return (
    <Suspense fallback={<div>Loading workspace...</div>}>
      <WorkspaceContent initialMessages={initialMessages} />
    </Suspense>
  );
}

const ChatMessageItem = React.memo(
  ({
    m,
    setHighlightedRow,
    isStreaming,
  }: {
    m: Message;
    setHighlightedRow: (value: number | null) => void;
    isStreaming: boolean;
  }) => {
    return (
      <div
        className={`chat-message-enter flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
      >
        <div
          className={`max-w-[90%] rounded-xl px-4 py-3 shadow-sm ${
            m.role === 'user'
              ? 'bg-sky-600 text-white'
              : 'border-border bg-card text-foreground border'
          }`}
        >
          <span
            className={`${m.role === 'user' ? 'text-sky-100' : 'text-muted-foreground'} mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase`}
          >
            {m.role === 'user' ? 'Você' : 'SOL Assistant'}
            {isStreaming && (
              <span className="inline-flex gap-0.5">
                <span
                  className="h-1 w-1 animate-bounce rounded-full bg-sky-400"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="h-1 w-1 animate-bounce rounded-full bg-sky-400"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="h-1 w-1 animate-bounce rounded-full bg-sky-400"
                  style={{ animationDelay: '300ms' }}
                />
              </span>
            )}
          </span>
          <div
            className={`prose prose-sm max-w-none font-sans text-sm leading-relaxed ${
              m.role === 'user' ? 'text-sky-50' : 'text-foreground dark:prose-invert'
            }`}
          >
            {/* During streaming: render plain text to avoid ReactMarkdown DOM churn on every token */}
            {isStreaming ? (
              <p className="m-0 whitespace-pre-wrap">{m.content}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    if (href?.startsWith('#article-row-')) {
                      const index = parseInt(href.replace('#article-row-', ''), 10);
                      return (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setHighlightedRow(index);
                            const el = document.getElementById(`article-row-${index}`);
                            if (el) {
                              el.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              });
                            }
                            setTimeout(() => setHighlightedRow(null), 3000);
                          }}
                          className="inline-flex items-center rounded bg-sky-500/10 px-1 font-mono font-bold text-sky-600 transition-colors hover:bg-sky-500/20 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:bg-sky-900/40 dark:text-sky-400 dark:hover:bg-sky-800/60 dark:hover:text-sky-300"
                        >
                          [{index}]
                        </button>
                      );
                    }
                    return (
                      <a
                        href={href}
                        className="font-medium text-sky-600 underline decoration-sky-500/30 underline-offset-4 hover:decoration-sky-500 dark:text-sky-400"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {m.content.replace(/\[(\d+)\]/g, '[[**$1**]](#article-row-$1)')}
              </ReactMarkdown>
            )}
          </div>

          {/* Render Tool Invocations as subtle chips */}
          {m.toolInvocations && m.toolInvocations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.toolInvocations.map((toolInvocation: any) => {
                const { toolCallId, state, toolName, result } = toolInvocation;

                let loadingText = 'Processando...';
                let successText = 'Concluído';
                let isError = false;

                if (toolName === 'search_sol_database') {
                  loadingText = 'Buscando na base de dados...';
                  if (state === 'result') {
                    if (result?.success === false || result?.total_found === 0) {
                      successText = 'Pesquisa concluída. Nenhum resultado.';
                      isError = true;
                    } else {
                      successText = `Pesquisa concluída. ${result?.total_found || ''} artigos encontrados — Extração iniciada.`;
                    }
                  }
                } else if (toolName === 'generate_systematic_review') {
                  loadingText = 'Analisando artigos e escrevendo revisão...';
                  successText = 'Revisão Sistemática estruturada.';
                }

                return (
                  <div
                    key={toolCallId}
                    className={`flex items-center gap-2 rounded border px-2 py-1.5 font-mono text-[10px] shadow-sm ${
                      state === 'result'
                        ? isError
                          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400'
                        : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-400'
                    }`}
                  >
                    {state === 'result' ? (
                      <>
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        />
                        <span>{successText}</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
                        <span>{loadingText}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Re-render when streaming state flips (plain text → markdown switch)
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    // Re-render when content changes (streaming tokens or edits)
    if (prevProps.m.content !== nextProps.m.content) return false;
    // Re-render when tool invocations change
    const prevTools = JSON.stringify(prevProps.m.toolInvocations || []);
    const nextTools = JSON.stringify(nextProps.m.toolInvocations || []);
    if (prevTools !== nextTools) return false;
    return true;
  }
);
ChatMessageItem.displayName = 'ChatMessageItem';

/** Shown immediately after user sends — before the first assistant token arrives */
const TypingIndicator = () => (
  <div className="chat-message-enter flex flex-col items-start">
    <div className="border-border bg-card text-foreground max-w-[90%] rounded-xl border px-4 py-3 shadow-sm">
      <span className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
        SOL Assistant
      </span>
      <div className="flex items-center gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground/50 block h-2 w-2 rounded-full"
            style={{
              animation: `typing-dot 1.2s ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>
    </div>
  </div>
);

function WorkspaceContent({ initialMessages }: { initialMessages?: Message[] }) {
  const searchParams = useSearchParams();
  const params = useParams();
  const pathname = usePathname();
  const searchParamQueryId = searchParams?.get('q');
  const pathQueryId = params?.id as string | undefined;
  const urlQueryId = pathQueryId || searchParamQueryId;

  const [highlightedRow, setHighlightedRowState] = useState<number | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Stable callback so ChatMessageItem React.memo is not busted on every Supabase tick
  const setHighlightedRow = useCallback((value: number | null) => {
    setHighlightedRowState(value);
  }, []);

  // Authentication
  const { status } = useSession();

  // 1. Initial State for queryId
  const [sessionQueryId, setSessionQueryId] = useState<string | null>(
    urlQueryId ??
      (typeof window !== 'undefined' && !initialMessages
        ? localStorage.getItem('sol_active_query_id')
        : null)
  );

  // STABLE chat ID: useChat completely destroys the message array if its `id` prop changes mid-stream.
  // We MUST decouple the internal chat thread ID from the dynamic `sessionQueryId` which changes when
  // the AI returns a search tool result.
  const [chatId] = useState<string>(() => {
    if (urlQueryId) return urlQueryId;
    return typeof crypto !== 'undefined'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(7);
  });

  // 2. Vercel AI SDK Chat
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
    isLoading,
    append,
    setInput,
    setMessages,
  } = useChat({
    api: '/api/chat',
    id: chatId,
    initialMessages,
    body: { queryId: sessionQueryId },
  });

  const isClearingRef = useRef(false);

  // Handle "Nova Busca" clicks by observing standard Next.js navigation changes
  useEffect(() => {
    // We must check the actual window pathname to avoid wiping the session mid-stream
    // because Next.js usePathname does not update when we use history.replaceState!
    const isRootWorkspace =
      typeof window !== 'undefined' && window.location.pathname.endsWith('/workspace');

    if (!urlQueryId && isRootWorkspace && sessionQueryId) {
      isClearingRef.current = true;
      const timeoutId = setTimeout(() => {
        setSessionQueryId(null);
        localStorage.removeItem('sol_active_query_id');
        setMessages([]);
        isClearingRef.current = false;
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [urlQueryId, sessionQueryId, setMessages, pathname]);

  // Intercept submit to force login
  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (status === 'unauthenticated') {
      setShowLoginModal(true);
      return;
    }
    originalHandleSubmit(e);
  };

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll: only when a NEW message is added, not on every streaming token
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const currentCount = messages.length;
    if (currentCount !== prevMessageCountRef.current) {
      prevMessageCountRef.current = currentCount;
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }
  }, [messages]);

  // With maxSteps > 1, the tool invocation is on an intermediate message — not the final one.
  const activeQueryId = useMemo(() => {
    if (sessionQueryId) return sessionQueryId;

    for (const msg of messages) {
      if (!msg.toolInvocations) continue;
      for (const tool of msg.toolInvocations as any[]) {
        if (tool.toolName === 'search_sol_database' && 'result' in tool) {
          const result = tool.result as { success: boolean; query_id?: string };
          if (result.success && result.query_id) return result.query_id;
        }
      }
    }
    return null;
  }, [messages, sessionQueryId]);

  const hasZeroResults = useMemo(() => {
    if (!activeQueryId) return false;
    for (const msg of messages) {
      if (!msg.toolInvocations) continue;
      for (const tool of msg.toolInvocations as any[]) {
        if (tool.toolName === 'search_sol_database' && 'result' in tool) {
          const result = tool.result as {
            success: boolean;
            query_id?: string;
            total_found?: number;
          };
          if (result.query_id === activeQueryId && (result.total_found === 0 || !result.success)) {
            return true;
          }
        }
      }
    }
    return false;
  }, [messages, activeQueryId]);

  const isSearchRunning = useMemo(() => {
    return messages.some((m) =>
      m.toolInvocations?.some(
        (t: any) => t.toolName === 'search_sol_database' && t.state !== 'result'
      )
    );
  }, [messages]);

  // Pre-process messages before rendering:
  // 1. Hide [SISTEMA] prompts
  // 2. Merge database-hydrated 'tool' result messages into their parent 'assistant' calls
  //    so we don't render a separate floating bubble with just a success chip, and the original text bubble
  //    drops its "loading" chip in favor of this result.
  const displayMessages = useMemo(() => {
    const merged: Message[] = [];
    for (const m of messages) {
      if (typeof m.content === 'string' && m.content.startsWith('[SISTEMA]')) continue;

      if (m.role === 'tool' && m.toolInvocations) {
        const prevIdx = merged.length - 1;
        if (prevIdx >= 0 && merged[prevIdx].role === 'assistant') {
          const prevMsg = { ...merged[prevIdx] };
          const newInvocations = prevMsg.toolInvocations ? [...prevMsg.toolInvocations] : [];

          m.toolInvocations.forEach((ti: any) => {
            const matchIdx = newInvocations.findIndex((t: any) => t.toolCallId === ti.toolCallId);
            if (matchIdx >= 0) {
              newInvocations[matchIdx] = ti; // replace 'call' with 'result'
            } else {
              newInvocations.push(ti);
            }
          });

          prevMsg.toolInvocations = newInvocations;
          merged[prevIdx] = prevMsg;
          continue; // Skip rendering 'tool' as a standalone bubble
        }
      }

      merged.push({ ...m });
    }
    return merged;
  }, [messages]);

  // Persist to localStorage whenever we find a newly generated query_id from messages
  useEffect(() => {
    if (activeQueryId && activeQueryId !== sessionQueryId) {
      // Defer state update to avoid synchronous cascading renders warning
      const timeoutId = setTimeout(() => {
        setSessionQueryId(activeQueryId);
        localStorage.setItem('sol_active_query_id', activeQueryId);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [activeQueryId, sessionQueryId]);

  // articleCountRef holds the latest articles list for the zero-results timer check (no re-render)
  const articleCountRef = useRef<any[]>([]);

  // Sync URL with active query to guarantee route visibility without unmounting the live AI stream
  useEffect(() => {
    if (activeQueryId && !isClearingRef.current) {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : pathname;
      const targetPath = `/workspace/query/${activeQueryId}`;
      if (currentPath !== targetPath) {
        // We use native history.replaceState because Next.js router.replace to a dynamic
        // segment [id] triggers the Server Component (page.tsx) to fetch and remount,
        // destroying the active chat streaming layout.
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [activeQueryId, pathname]);

  // Stable ref for `append` — prevents onArticlesChange from recreating on every render
  // (append from useChat is not stable; putting it in a ref avoids the prop-change cascade into ExtractionsPanel)
  const appendRef = useRef(append);
  useEffect(() => {
    appendRef.current = append;
  }); // runs after every render, before effects

  // Auto-trigger systematic review when all articles reach a terminal status
  // ExtractionsPanel calls onArticlesChange which updates articleCountRef without a re-render
  const reviewTriggeredRef = useRef(false);
  const onArticlesChange = useCallback(
    (articles: any[]) => {
      articleCountRef.current = articles;
      // NOTE: no setState here — that would re-render WorkspaceContent on every Supabase tick
      if (!activeQueryId || reviewTriggeredRef.current) return;
      if (articles.length === 0) return;

      const TERMINAL = ['done', 'abstract_only', 'failed'];
      const allFinished = articles.every((a: any) => TERMINAL.includes(a.status ?? ''));
      const hasContent = articles.some(
        (a: any) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      if (allFinished && hasContent && !reviewTriggeredRef.current) {
        reviewTriggeredRef.current = true;
        localStorage.removeItem('sol_active_query_id');
        appendRef.current({
          role: 'user',
          content: `[SISTEMA] Todos os artigos foram processados para a query ${activeQueryId}. Por favor, gere agora a Revisao Sistematica usando generate_systematic_review com query_id="${activeQueryId}" e max_articles=10.`,
        });
      }
    },
    [activeQueryId] // stable: no `append`, no `isLoading` — uses refs instead
  );

  // Reset trigger guard when a new query starts
  useEffect(() => {
    reviewTriggeredRef.current = false;
  }, [activeQueryId]);

  // Zero-results safety net: if the search returned nothing after 60s, tell the AI
  const zeroResultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeQueryId || isLoading || hasZeroResults) return;

    zeroResultsTimerRef.current = setTimeout(() => {
      if (articleCountRef.current.length === 0 && !reviewTriggeredRef.current) {
        reviewTriggeredRef.current = true;
        console.log('[WorkspaceContent] ⚠️ Zero articles after 60s — sending feedback to AI');
        appendRef.current({
          role: 'user',
          content: `[SISTEMA] A busca para a query ${activeQueryId} foi concluída mas nenhum artigo foi encontrado ou processado. Por favor, informe o usuário que a busca não retornou resultados e sugira refinar os termos de pesquisa.`,
        });
      }
    }, 60_000);

    return () => {
      if (zeroResultsTimerRef.current) clearTimeout(zeroResultsTimerRef.current);
    };
  }, [activeQueryId, isLoading, hasZeroResults]); // stable: no `append` dep — uses appendRef instead

  return (
    <div className="bg-background text-foreground flex h-screen w-full flex-col overflow-hidden font-sans">
      {/* Top Header */}
      <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div className="bg-border h-4 w-px" />
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-sky-500" />
            <span className="text-foreground/80 text-sm font-semibold tracking-tight">
              Workspace
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area: Branch based on activity */}
      {messages.length === 0 && !activeQueryId ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 px-10">
          <div className="w-full max-w-3xl text-center">
            <h1 className="text-foreground mb-4 text-4xl font-semibold tracking-tight">
              O que você quer pesquisar hoje?
            </h1>
            <p className="text-muted-foreground mb-8 text-lg">
              Descreva sua necessidade em linguagem natural. Nós estruturamos a revisão sistemática
              ibero-americana perfeita.
            </p>

            <form
              onSubmit={handleSubmit}
              className="relative mx-auto flex w-full max-w-2xl items-center shadow-lg"
            >
              <Search className="text-muted-foreground absolute left-4 h-5 w-5" />
              <Input
                value={input}
                onChange={handleInputChange}
                placeholder="Ex: Procure artigos sobre IA na educação básica..."
                className="border-border bg-muted/30 focus-visible:bg-background h-16 rounded-full pr-14 pl-12 text-base shadow-sm backdrop-blur transition-all focus-visible:ring-2 focus-visible:ring-sky-500"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="absolute top-2 right-2 h-12 w-12 rounded-full bg-sky-600 text-white shadow-sm transition-all hover:scale-105 hover:bg-sky-500"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </form>

            <div className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                'IA na educação básica brasileira',
                'Gamificação no ensino de engenharia',
                'Acessibilidade em interfaces web',
                'Metodologias ágeis em startups',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    if (status === 'unauthenticated') {
                      setShowLoginModal(true);
                    }
                  }}
                  className="border-border bg-card hover:bg-accent flex flex-col items-start justify-between rounded-xl border p-4 text-left shadow-sm transition-all hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                >
                  <Search className="text-muted-foreground mb-3 h-4 w-4" />
                  <span className="text-foreground/80 text-sm font-medium">{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Split Pane View for Active Search */
        <ResizablePanelGroup orientation="horizontal" className="w-full flex-1">
          {/* LEFT PANEL: Chat & AI Orchestration */}
          <ResizablePanel defaultSize={40} minSize={30} className="bg-background flex flex-col">
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-6">
                {displayMessages.map((m: Message) => {
                  // Only the very last message in the ENTIRE array can be streaming
                  const isLastInTotal =
                    messages.length > 0 && m.id === messages[messages.length - 1].id;
                  const isStreaming = isLoading && isLastInTotal && m.role === 'assistant';

                  return (
                    <ChatMessageItem
                      key={m.id}
                      m={m}
                      setHighlightedRow={setHighlightedRow}
                      isStreaming={isStreaming}
                    />
                  );
                })}
                {/* Typing indicator: show when loading but assistant hasn't started responding yet */}
                {isLoading &&
                  messages.length > 0 &&
                  messages.filter((m) => !m.content.startsWith('[SISTEMA]')).at(-1)?.role ===
                    'user' && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Chat Input */}
            <div className="border-border bg-background border-t p-4">
              <form onSubmit={handleSubmit} className="relative mx-auto flex max-w-2xl gap-2">
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Resposta ou nova iteração..."
                  className="border-border bg-card text-foreground h-12 rounded-md pr-12 font-sans text-sm shadow-sm transition-colors focus-visible:border-sky-500 focus-visible:ring-1 focus-visible:ring-sky-500"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isLoading || !input.trim()}
                  className="absolute top-1 right-1 h-10 w-10 rounded-md bg-sky-600 text-white shadow-sm transition-colors hover:bg-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className="bg-border w-1 transition-colors hover:bg-sky-500/50"
          />

          {/* RIGHT PANEL: Data Grid */}
          <ResizablePanel defaultSize={60} minSize={30}>
            <ExtractionsPanel
              activeQueryId={activeQueryId}
              highlightedRow={highlightedRow}
              onArticlesChange={onArticlesChange}
              hasZeroResults={hasZeroResults}
              isSearchRunning={isSearchRunning}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Login Authentication Modal */}
      <Dialog open={showLoginModal} onOpenChange={setShowLoginModal}>
        <DialogContent className="border-border bg-card overflow-hidden p-0 shadow-2xl sm:max-w-md">
          <div className="flex flex-col items-center justify-center p-8 text-center sm:p-10">
            <div className="mb-4 flex aspect-square size-12 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg shadow-sky-500/20">
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
                className="border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground flex h-12 w-full items-center justify-center gap-3 rounded-full border text-base font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-sky-500"
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

const ExtractionsPanel = React.memo(
  ({
    activeQueryId,
    highlightedRow,
    onArticlesChange,
    hasZeroResults,
    isSearchRunning,
  }: {
    activeQueryId: string | null;
    highlightedRow: number | null;
    onArticlesChange: (articles: any[]) => void;
    hasZeroResults: boolean;
    isSearchRunning: boolean;
  }) => {
    const articles = useSupabaseRealtime(activeQueryId);

    // Mapeia quais linhas estão expandidas (para ler o abstract/tldr completo)
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    // Mapeia quais linhas estão selecionadas (checkbox)
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

    // DIAGNOSTIC
    useEffect(() => {
      onArticlesChange(articles);
    }, [articles, onArticlesChange]);

    const toggleRowExpansion = (id: string) => {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const toggleRowSelection = (id: string, checked: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    };

    const toggleAllSelection = (checked: boolean) => {
      if (checked) {
        setSelectedRows(new Set(articles.map((a) => a.id)));
      } else {
        setSelectedRows(new Set());
      }
    };

    const copyToClipboard = async (text: string, description: string) => {
      try {
        await navigator.clipboard.writeText(text);
        // Opcional: Adicionar um pequeno toast ou notificação aqui futuramente
        console.log(`Copiado: ${description}`);
      } catch (err) {
        console.error('Falha ao copiar', err);
      }
    };

    const exportSelected = (format: 'csv' | 'bibtex') => {
      const selectedArticles = articles.filter((a) => selectedRows.has(a.id));
      if (selectedArticles.length === 0) return;

      if (format === 'csv') {
        const headers = [
          'Title',
          'Authors',
          'Year',
          'DOI',
          'Keywords',
          'CitationCount',
          'Abstract',
        ];
        const csvContent =
          headers.join(',') +
          '\n' +
          selectedArticles
            .map((a) =>
              [
                `"${(a.title || '').replace(/"/g, '""')}"`,
                `"${(a.authors || '').replace(/"/g, '""')}"`,
                a.publicationYear || '',
                a.doi || '',
                `"${(a.keywords || '').replace(/"/g, '""')}"`,
                a.citationCount || '',
                `"${(a.abstract || '').replace(/"/g, '""')}"`,
              ].join(',')
            )
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (format === 'bibtex') {
        const bibtexContent = selectedArticles
          .map((a) => {
            const authorFormat = a.authors ? a.authors.split(', ').join(' and ') : 'Unknown';
            return `@article{${a.doi ? a.doi.replace(/\//g, '_') : 'auth' + (a.publicationYear || '')},\n  title={${a.title}},\n  author={${authorFormat}},\n  year={${a.publicationYear || 'unknown'}},\n  url={${a.originalUrl}}${a.doi ? `,\n  doi={${a.doi}}` : ''}${a.publisher ? `,\n  publisher={${a.publisher}}` : ''}\n}`;
          })
          .join('\n\n');

        const blob = new Blob([bibtexContent], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `references_${new Date().toISOString().split('T')[0]}.bib`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    };

    const isAllSelected = articles.length > 0 && selectedRows.size === articles.length;
    const isIndeterminate = selectedRows.size > 0 && selectedRows.size < articles.length;

    return (
      <div className="bg-muted/10 flex h-full flex-col">
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Database className="h-5 w-5 text-sky-500" /> Acervo de Extração
                {articles.length > 0 && (
                  <span className="ml-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-medium text-sky-500">
                    {articles.length}
                  </span>
                )}
              </h2>
              <p className="text-muted-foreground text-sm">
                Processamento assíncrono e extração de metadados em tempo real.
              </p>
            </div>
            {selectedRows.size > 0 && (
              <div className="animate-in fade-in zoom-in flex items-center gap-2 duration-200">
                <span className="text-muted-foreground text-sm font-medium">
                  {selectedRows.size} selecionado(s)
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-2 border-dashed">
                      <Download className="h-3.5 w-3.5" />
                      Exportar
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Formato de Exportação</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => exportSelected('csv')}>
                      Tabela CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportSelected('bibtex')}>
                      Citações BibTeX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {activeQueryId ? (
            <div className="flex flex-col gap-4">
              {/* Progress Bar */}
              {articles.length > 0 && (
                <div className="border-border bg-card/50 flex items-center gap-4 rounded-xl border px-4 py-3">
                  <div className="flex-1">
                    <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
                      <span>Progresso da Extração</span>
                      <span className="font-mono text-sky-400">
                        {
                          articles.filter((a) =>
                            ['done', 'abstract_only', 'failed'].includes(a.status || '')
                          ).length
                        }{' '}
                        / {articles.length} concluídos
                      </span>
                    </div>
                    <Progress
                      value={
                        (articles.filter((a) =>
                          ['done', 'abstract_only', 'failed'].includes(a.status || '')
                        ).length /
                          articles.length) *
                        100
                      }
                      className="bg-muted h-1.5"
                    />
                  </div>
                </div>
              )}

              <div className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="border-border bg-muted/50 text-muted-foreground sticky top-0 z-10 border-b font-mono text-xs backdrop-blur">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-center font-medium">
                        <Checkbox
                          checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                          onCheckedChange={(checked) => toggleAllSelection(!!checked)}
                          aria-label="Select all"
                          className="translate-y-[2px]"
                        />
                      </th>
                      <th className="w-10 px-2 py-2.5 text-center font-medium">#</th>
                      <th className="px-3 py-2.5 font-medium">Metadados do Artigo</th>
                      <th className="w-24 px-3 py-2.5 font-medium">Status</th>
                      <th className="w-10 px-3 py-2.5 text-center font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {articles.map((article, idx) => {
                      const rowNumber = idx + 1;
                      const isExpanded = expandedRows.has(article.id);
                      const isSelected = selectedRows.has(article.id);

                      const displayContent = article.tldrContent || article.abstract;
                      const contentSource = article.tldrContent ? 'TL;DR IA' : 'ABSTRACT';

                      return (
                        <tr
                          key={article.id}
                          id={`article-row-${rowNumber}`}
                          className={`group transition-colors ${isSelected ? 'bg-sky-500/5 dark:bg-sky-500/10' : 'hover:bg-muted/30'} ${highlightedRow === rowNumber ? 'bg-sky-500/10 ring-2 ring-sky-500 ring-inset' : ''}`}
                        >
                          <td className="px-3 py-4 text-center align-top">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                toggleRowSelection(article.id, !!checked)
                              }
                              className="translate-y-[2px]"
                            />
                          </td>
                          <td
                            className={`px-2 py-4 text-center align-top font-mono text-xs transition-colors ${highlightedRow === rowNumber ? 'font-bold text-sky-500' : 'text-muted-foreground'}`}
                          >
                            {rowNumber.toString().padStart(2, '0')}
                          </td>
                          <td className="max-w-xl px-3 py-4 align-top">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <a
                                  href={article.originalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-foreground mb-1.5 line-clamp-2 text-sm leading-tight font-semibold hover:text-sky-500 hover:underline hover:decoration-sky-500/30"
                                  title={article.title}
                                >
                                  {article.title}
                                </a>

                                <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                  <span
                                    className="max-w-[200px] truncate font-medium"
                                    title={article.authors || ''}
                                  >
                                    {article.authors?.split(',')[0]}{' '}
                                    {article.authors?.includes(',') && 'et al.'}
                                  </span>
                                  <span>•</span>
                                  <span className="font-mono">{article.publicationYear}</span>
                                  <span>•</span>
                                  <span
                                    className="max-w-[150px] truncate"
                                    title={article.sourceName || ''}
                                  >
                                    {article.sourceName}
                                  </span>

                                  {article.citationCount != null && article.citationCount > 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-500">
                                        <Flame className="h-3 w-3" />
                                        {article.citationCount}{' '}
                                        {article.citationCount === 1 ? 'citação' : 'citações'}
                                      </span>
                                    </>
                                  )}

                                  {article.doi && (
                                    <>
                                      <span>•</span>
                                      <a
                                        href={`https://doi.org/${article.doi}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 transition-colors hover:text-sky-500"
                                      >
                                        <LinkIcon className="h-3 w-3" />
                                        <span className="font-mono hover:underline">DOI</span>
                                      </a>
                                    </>
                                  )}
                                </div>

                                {article.keywords && (
                                  <div
                                    className={`mb-3 flex flex-wrap gap-1 ${!isExpanded ? 'max-h-6 overflow-hidden' : ''}`}
                                  >
                                    {article.keywords.split(',').map((kw, i) => (
                                      <span
                                        key={i}
                                        className="bg-muted text-muted-foreground inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                                      >
                                        {kw.trim()}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {displayContent && (
                                  <div className="border-border bg-muted/20 group/content relative rounded-md border p-3">
                                    <div className="mb-1 flex items-center justify-between">
                                      <div
                                        className={`font-mono text-[10px] font-semibold tracking-wider uppercase ${contentSource === 'TL;DR IA' ? 'text-sky-500' : 'text-slate-500'}`}
                                      >
                                        {contentSource}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full opacity-0 transition-opacity group-hover/content:opacity-100"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyToClipboard(displayContent, contentSource);
                                        }}
                                        title="Copiar texto"
                                      >
                                        <Copy className="text-muted-foreground h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div
                                      className={`text-foreground/90 font-sans text-xs leading-relaxed ${!isExpanded ? 'line-clamp-2' : ''}`}
                                    >
                                      {displayContent}
                                    </div>
                                    <button
                                      onClick={() => toggleRowExpansion(article.id)}
                                      className="mt-1 flex items-center gap-0.5 text-[10px] font-medium text-sky-500 transition-colors hover:text-sky-600"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp className="h-3 w-3" /> Mostrar menos
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="h-3 w-3" /> Ler completo
                                        </>
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top">
                            <span
                              className={`inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${
                                article.status === 'done'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
                                  : article.status === 'abstract_only'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400'
                                    : article.status === 'failed'
                                      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400'
                                      : 'border-sky-200 bg-sky-50 text-sky-700 shadow-[0_0_8px_rgba(14,165,233,0.1)] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400 dark:shadow-[0_0_8px_rgba(14,165,233,0.2)]'
                              }`}
                            >
                              {['pending', 'processing', 'llm_processing'].includes(
                                article.status || ''
                              ) && (
                                <span className="mr-1.5 flex h-1.5 w-1.5">
                                  <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-sky-400 opacity-75"></span>
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"></span>
                                </span>
                              )}
                              {article.status ? article.status.replace('_', ' ') : 'UNKNOWN'}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-right align-top">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={() =>
                                    copyToClipboard(article.originalUrl, 'Link Original')
                                  }
                                >
                                  <LinkIcon className="text-muted-foreground mr-2 h-4 w-4" />
                                  <span>Copiar Link</span>
                                </DropdownMenuItem>
                                {article.doi && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      copyToClipboard(`https://doi.org/${article.doi}`, 'Link DOI')
                                    }
                                  >
                                    <LinkIcon className="mr-2 h-4 w-4 text-sky-500" />
                                    <span>Copiar DOI</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => copyToClipboard(article.title || '', 'Título')}
                                >
                                  <Copy className="text-muted-foreground mr-2 h-4 w-4" />
                                  <span>Copiar Título</span>
                                </DropdownMenuItem>
                                {displayContent && (
                                  <DropdownMenuItem
                                    onClick={() => copyToClipboard(displayContent, contentSource)}
                                  >
                                    <FileText className="text-muted-foreground mr-2 h-4 w-4" />
                                    <span>Copiar {contentSource}</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-muted-foreground font-mono text-xs">
                                  CITAÇÃO
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => {
                                    const year = article.publicationYear
                                      ? ` (${article.publicationYear})`
                                      : '';
                                    copyToClipboard(
                                      `${article.authors || 'Unknown'}.${year}. ${article.title}. ${article.sourceName || ''}.`,
                                      'Citação (APA)'
                                    );
                                  }}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  <span>Formato APA</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    let abntAuthors = 'Unknown';
                                    if (article.authors) {
                                      abntAuthors = article.authors
                                        .split(', ')
                                        .map((author) => {
                                          const parts = author.split(' ');
                                          if (parts.length > 1) {
                                            return `${parts.pop()?.toUpperCase()}, ${parts.join(' ')}`;
                                          }
                                          return author.toUpperCase();
                                        })
                                        .join('; ');
                                    }
                                    copyToClipboard(
                                      `${abntAuthors}. ${article.title}. ${article.sourceName || ''}, ${article.publicationYear || ''}.`,
                                      'Citação (ABNT)'
                                    );
                                  }}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  <span>Formato ABNT</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {articles.length === 0 && !hasZeroResults && (
                  <div className="p-8">
                    <div className="space-y-4">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                          <Skeleton className="h-4 w-6 rounded" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-3/4 rounded" />
                            <Skeleton className="h-3 w-1/3 rounded opacity-50" />
                          </div>
                          <Skeleton className="h-5 w-20 rounded" />
                        </div>
                      ))}
                    </div>
                    <div className="text-muted-foreground mt-8 animate-pulse text-center font-mono text-xs">
                      Aguardando indexação dos primeiros artigos...
                    </div>
                  </div>
                )}

                {hasZeroResults && (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="bg-destructive/10 text-destructive mb-4 rounded-full p-4">
                      <Search className="h-8 w-8" />
                    </div>
                    <h3 className="text-foreground mb-2 text-lg font-semibold tracking-tight">
                      Busca sem resultados
                    </h3>
                    <p className="text-muted-foreground max-w-sm text-sm">
                      Não encontramos nenhum artigo na base da SBC OpenLib que corresponda aos
                      critérios desta pesquisa. Tente utilizar termos mais abrangentes.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : isSearchRunning ? (
            <div className="border-border bg-muted/10 flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
              <div className="mb-4 flex items-center justify-center rounded-full bg-sky-500/10 p-4 ring-1 ring-sky-500/30">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              </div>
              <h3 className="text-foreground/80 mb-2 font-medium tracking-tight">
                Pesquisando e inicializando extração...
              </h3>
              <p className="text-muted-foreground w-full max-w-sm text-sm">
                Aguarde enquanto a inteligência artificial consulta a base de dados da SBC OpenLib e
                organiza os resultados.
              </p>

              <div className="mt-8 w-full max-w-xs space-y-3 opacity-60">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-5/6 rounded" />
                <Skeleton className="h-4 w-4/6 rounded" />
              </div>
            </div>
          ) : (
            <div className="border-border bg-muted/10 flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
              <div className="bg-muted/50 ring-border/50 mb-4 flex items-center justify-center rounded-full p-4 ring-1">
                <Database className="text-muted-foreground h-8 w-8" />
              </div>
              <h3 className="text-foreground/80 mb-1 font-medium tracking-tight">
                Nenhum acervo ativo
              </h3>
              <p className="text-muted-foreground max-w-xs font-sans text-sm">
                Inicie uma pesquisa no painel ao lado para começar a extração e análise de artigos.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
);
ExtractionsPanel.displayName = 'ExtractionsPanel';

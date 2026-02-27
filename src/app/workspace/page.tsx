'use client';

import React, { useState, useEffect, useRef, useMemo, Suspense, useCallback } from 'react';
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
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Activity,
  Terminal,
  Check,
  Play,
  Globe,
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
import { useRouter, useSearchParams, useParams, usePathname } from 'next/navigation';
import { useChat } from 'ai/react';

export default function WorkspacePage({ initialMessages }: { initialMessages?: Message[] }) {
  return (
    <Suspense fallback={<div>Loading workspace...</div>}>
      <WorkspaceContent initialMessages={initialMessages} />
    </Suspense>
  );
}

/** Interactive card for search proposals */
const SearchProposalCard = ({ queries, queryId, onExecute, isExecuted, isRunning }: any) => {
  const [editableQueries, setEditableQueries] = useState<string[]>(queries || []);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleQueryChange = (index: number, newValue: string) => {
    const updated = [...editableQueries];
    updated[index] = newValue;
    setEditableQueries(updated);
  };

  return (
    <div className="border-border bg-card/50 mt-4 overflow-hidden rounded-xl border shadow-sm backdrop-blur-sm">
      <div
        className="border-border bg-muted/30 hover:bg-muted/50 flex cursor-pointer items-center justify-between border-b px-4 py-2.5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-sky-500" />
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Estratégia de Busca SOL ({editableQueries.length} string
            {editableQueries.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-muted/10 border-border animate-in slide-in-from-top-1 fade-in border-b p-4 duration-200">
          <div className="space-y-2">
            {!isExecuted && (
              <div className="text-muted-foreground px-1 text-[10px] font-bold tracking-wider uppercase">
                Strings geradas (Edite se necessário):
              </div>
            )}
            {editableQueries.map((q: string, i: number) => (
              <Input
                key={i}
                value={q}
                onChange={(e) => handleQueryChange(i, e.target.value)}
                disabled={isExecuted}
                title={q}
                className={`bg-background h-8 w-full font-mono text-[11px] focus-visible:ring-1 focus-visible:ring-sky-500 ${isExecuted ? 'cursor-not-allowed opacity-70' : ''}`}
              />
            ))}
          </div>
        </div>
      )}

      {!isExecuted && (
        <div className="bg-card/50 p-4">
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => onExecute(editableQueries, queryId)}
              disabled={!queryId || isRunning}
              className="w-full gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
              size="sm"
            >
              {!queryId ? (
                <>
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> Preparando
                  Card...
                </>
              ) : isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Executar Busca Agora
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const GlobalSearchProposalCard = ({ query, queryId, onExecute, isExecuted, isRunning }: any) => {
  const [editableQuery, setEditableQuery] = useState<string>(query || '');
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-border bg-card/50 mt-4 overflow-hidden rounded-xl border shadow-sm backdrop-blur-sm">
      <div
        className="border-border bg-muted/30 hover:bg-muted/50 flex cursor-pointer items-center justify-between border-b px-4 py-2.5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-500" />
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Busca Global (OpenAlex)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-muted/10 border-border animate-in slide-in-from-top-1 fade-in border-b p-4 duration-200">
          <div className="space-y-2">
            {!isExecuted && (
              <div className="text-muted-foreground px-1 text-[10px] font-bold tracking-wider uppercase">
                Editar Query (Opcional):
              </div>
            )}
            <Input
              value={editableQuery}
              onChange={(e) => setEditableQuery(e.target.value)}
              disabled={isExecuted}
              title={editableQuery}
              className={`bg-background h-8 w-full font-mono text-[11px] focus-visible:ring-1 focus-visible:ring-amber-500 ${isExecuted ? 'cursor-not-allowed opacity-70' : ''}`}
            />
          </div>
        </div>
      )}

      {!isExecuted && (
        <div className="bg-card/50 p-4">
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => onExecute([editableQuery], queryId, true)}
              disabled={!queryId || isRunning}
              className="w-full gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
              size="sm"
            >
              {!queryId ? (
                <>
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> Preparando
                  Card...
                </>
              ) : isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando Global...
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" /> Executar Busca Global
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const ChatMessageItem = React.memo(
  ({
    m,
    setHighlightedRow,
    isStreaming,
    userName,
    onExecuteSearch,
    executedProposalIds,
    runningSearches,
  }: {
    m: Message;
    setHighlightedRow: (value: number | null) => void;
    isStreaming: boolean;
    userName?: string | null;
    onExecuteSearch?: (queries: string[], qId: string, isGlobal?: boolean) => void;
    executedProposalIds?: Set<string>;
    runningSearches?: Set<string>;
  }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(m.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const isUser = m.role === 'user';
    const userInitial = userName ? userName[0].toUpperCase() : 'U';

    return (
      <div
        className={`chat-message-enter flex items-end gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {/* Avatar */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm transition-transform hover:scale-105 ${
            isUser
              ? 'bg-sky-600 text-white'
              : 'bg-card text-sky-600 ring-1 ring-sky-500/20 dark:bg-zinc-900'
          }`}
        >
          {isUser ? userInitial : <Library className="h-4 w-4" />}
        </div>

        {/* Message Content Wrapper */}
        <div
          className={`group relative flex max-w-[85%] flex-col ${isUser ? 'items-end' : 'items-start'}`}
        >
          <span
            className={`mb-1.5 flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase ${
              isUser ? 'text-sky-400' : 'text-muted-foreground'
            }`}
          >
            {isUser ? userName || 'Você' : 'SOL Assistant'}
            {isStreaming && (
              <span className="inline-flex gap-0.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1 w-1 animate-bounce rounded-full bg-sky-400"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            )}
          </span>

          <div
            className={`relative w-full rounded-2xl px-4 py-3 shadow-sm ring-1 transition-all ring-inset ${
              isUser
                ? 'rounded-tr-sm bg-sky-600 text-white ring-sky-500/50'
                : 'border-border bg-card text-foreground ring-border/50 rounded-tl-sm border'
            }`}
          >
            <div
              className={`prose prose-sm max-w-none font-sans text-[14px] leading-relaxed ${
                isUser ? 'prose-invert text-sky-50' : 'text-foreground dark:prose-invert'
              }`}
            >
              {isStreaming ? (
                <p className="m-0 whitespace-pre-wrap">{m.content}</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table({ children }) {
                      return (
                        <div className="my-4 w-full overflow-x-auto rounded-lg border border-zinc-200/50 dark:border-zinc-800/50">
                          <table className="min-w-full divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
                            {children}
                          </table>
                        </div>
                      );
                    },
                    thead({ children }) {
                      return (
                        <thead className="bg-zinc-50/50 dark:bg-zinc-900/50">{children}</thead>
                      );
                    },
                    th({ children }) {
                      return (
                        <th className="px-4 py-2 text-left text-[11px] font-bold tracking-tight text-zinc-500 uppercase">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return (
                        <td className="px-4 py-2 text-[13px] text-zinc-600 dark:text-zinc-300">
                          {children}
                        </td>
                      );
                    },
                    a({ href, children }) {
                      const isArticleLink = href?.startsWith('#article-row-');
                      return (
                        <a
                          href={href || '#'}
                          onClick={(e) => {
                            if (isArticleLink) {
                              e.preventDefault();
                              const id = (href as string).replace('#article-row-', '');
                              setHighlightedRow(parseInt(id, 10));
                              const el = document.getElementById(`article-row-${id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                          }}
                          className={`${
                            isArticleLink
                              ? 'underline decoration-sky-500/30 decoration-2 underline-offset-4 hover:text-sky-500 hover:decoration-sky-500'
                              : 'text-sky-500 hover:text-sky-600 dark:text-sky-400'
                          } font-semibold transition-all`}
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

            {/* Tool Indicators / Interactive Cards */}
            {m.toolInvocations && m.toolInvocations.length > 0 && (
              <div className="space-y-3">
                {m.toolInvocations.map((toolInvocation: any) => {
                  const { toolCallId, state, toolName, result } = toolInvocation;

                  // 1. Rendering Interactive Proposal Cards
                  console.log(`[UI] Tool Item: ${toolName}, state: ${state}, result:`, result);

                  if (
                    toolName === 'propose_search_sol_database' &&
                    (state === 'result' || state === 'call') &&
                    (result?.proposed || toolInvocation.args?.queries)
                  ) {
                    console.log(`[UI] Rendering SearchProposalCard in state: ${state}`);
                    const queries = result?.queries || toolInvocation.args?.queries;
                    const queryId = result?.query_id || toolInvocation.args?.query_id; // queryId might not be in call args

                    if (!queries) return null;

                    return (
                      <SearchProposalCard
                        key={toolCallId}
                        queries={queries}
                        queryId={queryId}
                        onExecute={onExecuteSearch}
                        isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                        isRunning={queryId ? runningSearches.has(queryId) : false}
                      />
                    );
                  }

                  if (
                    toolName === 'propose_search_global_database' &&
                    (state === 'result' || state === 'call') &&
                    (result?.proposed || toolInvocation.args?.query)
                  ) {
                    console.log(`[UI] Rendering GlobalSearchProposalCard in state: ${state}`);
                    const query = result?.query || toolInvocation.args?.query;
                    const queryId = result?.query_id || toolInvocation.args?.query_id;

                    if (!query) return null;

                    return (
                      <GlobalSearchProposalCard
                        key={toolCallId}
                        query={query}
                        queryId={queryId}
                        onExecute={onExecuteSearch}
                        isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                        isRunning={queryId ? runningSearches.has(queryId) : false}
                      />
                    );
                  }

                  // 2. Rendering Progress Pills
                  let loadingText = 'Processando...';
                  let successText = 'Concluído';
                  let isError = false;

                  if (toolName === 'search_sol_database' || toolName === 'search_global_database') {
                    loadingText =
                      toolName === 'search_global_database'
                        ? 'Buscando Global (OpenAlex)...'
                        : 'Buscando base de dados...';
                    if (state === 'result') {
                      if (result?.success === false || result?.total_found === 0) {
                        successText = 'Nenhum resultado.';
                        isError = true;
                      } else {
                        successText = `${result?.total_found} artigos — Extração iniciada.`;
                      }
                    }
                  } else if (toolName === 'generate_systematic_review') {
                    loadingText = 'Gerando síntese sistemática...';
                    successText = 'Revisão concluída.';
                  } else if (
                    toolName === 'propose_search_sol_database' ||
                    toolName === 'propose_search_global_database'
                  ) {
                    // Don't show progress pill for proposals if result is shown as a card,
                    // but show it during loading.
                    if (state === 'result') return null;
                    loadingText = 'Elaborando estratégia de busca...';
                  }

                  return (
                    <div
                      key={toolCallId}
                      className={`mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] whitespace-nowrap shadow-sm transition-all ${
                        state === 'result'
                          ? isError
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-sky-200 bg-sky-50 text-sky-700'
                      }`}
                    >
                      {state === 'result' ? (
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
                      )}
                      {state === 'result' ? successText : loadingText}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Assistant Actions (Copy) */}
          {!isUser && !isStreaming && (
            <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={handleCopy}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
              >
                {copied ? (
                  <>
                    <span className="text-emerald-500">✓</span> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copiar
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    if (prevProps.m.content !== nextProps.m.content) return false;
    if (prevProps.userName !== nextProps.userName) return false;
    if (prevProps.executedProposalIds?.size !== nextProps.executedProposalIds?.size) return false;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const pathname = usePathname();
  const searchParamQueryId = searchParams?.get('q');
  const pathQueryId = params?.id as string | undefined;
  const urlQueryId = pathQueryId || searchParamQueryId;

  const [highlightedRow, setHighlightedRowState] = useState<number | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [executedProposalIds, setExecutedProposalIds] = useState<Set<string>>(new Set());

  // Stable callback so ChatMessageItem React.memo is not busted on every Supabase tick
  const setHighlightedRow = useCallback((value: number | null) => {
    setHighlightedRowState(value);
  }, []);

  // Authentication
  const { data: session, status } = useSession();
  const userName = session?.user?.name;

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

  const [runningSearches, setRunningSearches] = useState<Set<string>>(new Set());
  const [zeroResultSearches, setZeroResultSearches] = useState<Set<string>>(new Set());

  const handleExecuteSearch = useCallback(
    async (queries: string[], qId: string, isGlobal = false) => {
      setExecutedProposalIds((prev) => new Set(prev).add(qId));
      setRunningSearches((prev) => new Set(prev).add(qId));
      setZeroResultSearches((prev) => {
        const n = new Set(prev);
        n.delete(qId);
        return n;
      });

      if (!qId) {
        console.error('[UI] Cannot execute search: query_id is missing');
        setRunningSearches((prev) => {
          const n = new Set(prev);
          n.delete(qId);
          return n;
        });
        return;
      }

      try {
        const searchEndPoint = isGlobal ? '/api/search/global' : '/api/search';
        const params = new URLSearchParams();
        queries.forEach((q) => params.append('q', q));
        params.append('query_id', qId);

        const res = await fetch(`${searchEndPoint}?${params.toString()}`);
        const data = await res.json();

        setRunningSearches((prev) => {
          const n = new Set(prev);
          n.delete(qId);
          return n;
        });

        if (!data.success || data.total_found === 0) {
          setZeroResultSearches((prev) => new Set(prev).add(qId));
        }

        if (data.success && data.total_found > 0) {
          setSessionQueryId(qId);
        }
      } catch (err) {
        console.error('Search execution failed:', err);
        setRunningSearches((prev) => {
          const n = new Set(prev);
          n.delete(qId);
          return n;
        });
        setZeroResultSearches((prev) => new Set(prev).add(qId));
      }
    },
    []
  );

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
    // Clear stale session state for new manual input
    setSessionQueryId(null);
    localStorage.removeItem('sol_active_query_id');
    reviewTriggeredRef.current = false;

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
  // With maxSteps > 1, the tool invocation is on an intermediate message — not the final one.
  const activeQueryId = useMemo(() => {
    // Traverse backwards to find the LATEST query_id from search tools
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg.toolInvocations) continue;
      for (const tool of msg.toolInvocations as any[]) {
        if (
          (tool.toolName === 'propose_search_sol_database' ||
            tool.toolName === 'propose_search_global_database' ||
            tool.toolName === 'search_sol_database' ||
            tool.toolName === 'search_global_database') &&
          'result' in tool
        ) {
          const result = tool.result as { success: boolean; query_id?: string };
          if (result.success && result.query_id) return result.query_id;
        }
      }
    }
    // Fallback to session/initial ID
    return sessionQueryId;
  }, [messages, sessionQueryId]);

  const hasZeroResults = useMemo(() => {
    if (!activeQueryId) return false;
    if (zeroResultSearches.has(activeQueryId)) return true;
    for (const msg of messages) {
      if (!msg.toolInvocations) continue;
      for (const tool of msg.toolInvocations as any[]) {
        if (
          (tool.toolName === 'search_sol_database' || tool.toolName === 'search_global_database') &&
          'result' in tool
        ) {
          const result = tool.result as {
            success: boolean;
            query_id?: string;
            total_found?: number;
          };
          if (
            (result.query_id || tool.args?.query_id) === activeQueryId &&
            (!result.success || (result.total_found !== undefined && result.total_found <= 5))
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }, [messages, activeQueryId, zeroResultSearches]);

  const isSearchRunning = useMemo(() => {
    if (activeQueryId && runningSearches.has(activeQueryId)) return true;
    return messages.some((m) =>
      m.toolInvocations?.some(
        (t: any) =>
          (t.toolName === 'search_sol_database' || t.toolName === 'search_global_database') &&
          t.state !== 'result'
      )
    );
  }, [messages, activeQueryId, runningSearches]);

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

  // articleCountRef holds the latest articles list for the zero-results timer check (no re-render)
  const articleCountRef = useRef<any[]>([]);

  // Sync URL with active query to guarantee route visibility without unmounting the live AI stream
  useEffect(() => {
    if (activeQueryId && !isClearingRef.current) {
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : pathname;
      const targetPath = `/workspace/query/${activeQueryId}`;
      if (currentPath !== targetPath) {
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [activeQueryId, pathname]);

  // Stable ref for `append`
  const appendRef = useRef(append);
  useEffect(() => {
    appendRef.current = append;
  }, [append]);

  const initTriggered =
    typeof window !== 'undefined' && activeQueryId
      ? localStorage.getItem(`sol_review_done_${activeQueryId}`) === 'true'
      : false;
  const reviewTriggeredRef = useRef(initTriggered);

  // Sync the ref if activeQueryId changes
  useEffect(() => {
    if (activeQueryId && typeof window !== 'undefined') {
      reviewTriggeredRef.current =
        localStorage.getItem(`sol_review_done_${activeQueryId}`) === 'true';
    }
  }, [activeQueryId]);

  // LIFTED: Fetch articles in the parent so we can conditionally render the split pane layout
  const articles = useSupabaseRealtime(activeQueryId);
  const hasArticles = articles && articles.length > 0;

  const onArticlesChange = useCallback(
    (currentArticles: any[]) => {
      articleCountRef.current = currentArticles;
      if (!activeQueryId || reviewTriggeredRef.current || isLoading) return;
      if (currentArticles.length === 0) return;

      const TERMINAL = ['done', 'abstract_only', 'failed'];
      const allFinished = currentArticles.every((a: any) => TERMINAL.includes(a.status ?? ''));
      const hasContent = currentArticles.some(
        (a: any) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      if (allFinished && hasContent && !reviewTriggeredRef.current) {
        reviewTriggeredRef.current = true;
        if (typeof window !== 'undefined') {
          localStorage.setItem(`sol_review_done_${activeQueryId}`, 'true');
        }
        localStorage.removeItem('sol_active_query_id');

        const lowResultsHint =
          currentArticles.length <= 5
            ? ' (Poucos resultados encontrados. ALÉM do resumo, sugira IMEDIATAMENTE a busca global com propose_search_global_database)'
            : '';

        setTimeout(() => {
          appendRef.current({
            role: 'user',
            content: `[SISTEMA_REVISAO_SISTEMATICA] ${activeQueryId}${lowResultsHint}`,
          });
        }, 100);
      }
    },
    [activeQueryId, isLoading]
  );

  // Need to sync articles whenever they change so onArticlesChange rules apply
  useEffect(() => {
    onArticlesChange(articles);
  }, [articles, onArticlesChange]);

  // No reset needed here, we want it to persist via localStorage or the calculated state above
  // useEffect(() => {
  //   reviewTriggeredRef.current = false;
  // }, [activeQueryId]);

  // Automatically trigger fallback if we officially have zero results
  useEffect(() => {
    if (hasZeroResults && !reviewTriggeredRef.current) {
      reviewTriggeredRef.current = true;
      const t = setTimeout(() => {
        appendRef.current({
          role: 'user',
          content: `[SISTEMA] A busca na base SOL retornou poucos resultados (<= 5) ou falhou. Sugira IMEDIATAMENTE ao usuário tentar a busca na base global (OpenAlex) chamando a tool propose_search_global_database.`,
        });
      }, 500);
      return () => clearTimeout(t);
    }
  }, [hasZeroResults]);

  // Zero-results safety net (for unexpected delays without an explicit 0 results tool result)
  const zeroResultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeQueryId || isLoading || hasZeroResults) return;
    zeroResultsTimerRef.current = setTimeout(() => {
      if (articleCountRef.current.length === 0 && !reviewTriggeredRef.current) {
        reviewTriggeredRef.current = true;
        appendRef.current({
          role: 'user',
          content: `[SISTEMA] A busca para a query ${activeQueryId} foi concluída mas nenhum artigo foi encontrado ou processado.`,
        });
      }
    }, 60_000);
    return () => {
      if (zeroResultsTimerRef.current) clearTimeout(zeroResultsTimerRef.current);
    };
  }, [activeQueryId, isLoading, hasZeroResults]);

  // Update sessionQueryId when activeQueryId changes
  useEffect(() => {
    if (activeQueryId && activeQueryId !== sessionQueryId) {
      console.log(`[WorkspaceContent] 🔄 Switching active query to: ${activeQueryId}`);
      const timeoutId = setTimeout(() => {
        setSessionQueryId(activeQueryId);
        localStorage.setItem('sol_active_query_id', activeQueryId);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [activeQueryId, sessionQueryId]);

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
        /* Dynamic Layout View for Active Search */
        <ResizablePanelGroup orientation="horizontal" className="w-full flex-1">
          {/* LEFT PANEL: Chat & AI Orchestration */}
          <ResizablePanel
            defaultSize={hasArticles ? 40 : 100}
            minSize={30}
            className={`bg-background flex flex-col ${!hasArticles ? 'border-border/50 mx-auto max-w-4xl border-x shadow-sm' : ''}`}
          >
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-6">
                {displayMessages.map((m: Message) => {
                  // Only the very last message in the ENTIRE array can be streaming
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
                        isStreaming={isStreaming}
                        userName={userName}
                        onExecuteSearch={handleExecuteSearch}
                        executedProposalIds={executedProposalIds}
                        runningSearches={runningSearches}
                      />
                    </div>
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
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setMessages([]);
                    setSessionQueryId(null);
                    router.push('/workspace');
                  }}
                  title="Nova Busca"
                  className="text-muted-foreground h-12 w-12 rounded-lg hover:text-sky-500"
                >
                  <PlusCircle className="h-5 w-5" />
                </Button>
                <div className="relative flex-1">
                  <Input
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Resposta ou nova iteração..."
                    className="border-border bg-card text-foreground h-12 rounded-lg pr-24 font-sans text-sm shadow-sm transition-all focus-visible:border-sky-500 focus-visible:ring-1 focus-visible:ring-sky-500"
                    disabled={isLoading}
                  />
                  <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-2">
                    <div className="text-muted-foreground mr-1 hidden items-center gap-1 font-mono text-[10px] sm:flex">
                      <kbd className="bg-muted rounded border px-1">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="bg-muted rounded border px-1">Enter</kbd>
                    </div>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={isLoading || !input.trim()}
                      className="h-9 w-9 rounded-md bg-sky-600 text-white shadow-sm transition-all hover:bg-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </ResizablePanel>

          {hasArticles && (
            <>
              <ResizableHandle
                withHandle
                className="bg-border w-1 transition-colors hover:bg-sky-500/50"
              />

              {/* RIGHT PANEL: Data Grid */}
              <ResizablePanel
                defaultSize={60}
                minSize={30}
                className="animate-in fade-in slide-in-from-right-4 fill-mode-both duration-700"
              >
                <ExtractionsPanel
                  articles={articles}
                  activeQueryId={activeQueryId}
                  highlightedRow={highlightedRow}
                  hasZeroResults={hasZeroResults}
                  isSearchRunning={isSearchRunning}
                />
              </ResizablePanel>
            </>
          )}
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
    articles,
    activeQueryId,
    highlightedRow,
    hasZeroResults,
    isSearchRunning,
  }: {
    articles: any[];
    activeQueryId: string | null;
    highlightedRow: number | null;
    hasZeroResults: boolean;
    isSearchRunning: boolean;
  }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 20;

    // Mapeia quais linhas estão expandidas (para ler o abstract/tldr completo)
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    // Mapeia quais linhas estão selecionadas (checkbox)
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

    // Reset pagination when activeQueryId changes
    useEffect(() => {
      const t = setTimeout(() => {
        setCurrentPage(1);
        setExpandedRows(new Set());
        setSelectedRows(new Set());
      }, 0);
      return () => clearTimeout(t);
    }, [activeQueryId]);

    const totalPages = Math.ceil(articles.length / PAGE_SIZE);
    const paginatedArticles = articles.slice(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE
    );

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
            <div className="flex items-center gap-3">
              {totalPages > 1 && (
                <div className="border-border bg-card flex items-center gap-1 rounded-lg border p-1 shadow-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 font-mono text-xs font-bold whitespace-nowrap">
                    Página {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
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
                    {paginatedArticles.map((article, idx) => {
                      const absoluteIndex = (currentPage - 1) * PAGE_SIZE + idx;
                      const rowNumber = absoluteIndex + 1;
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

              {totalPages > 1 && (
                <div className="mt-2 flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="h-8 rounded-full px-4"
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" /> Anterior
                  </Button>
                  <span className="text-muted-foreground text-xs font-medium">
                    Página {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="h-8 rounded-full px-4"
                  >
                    Próximo <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
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

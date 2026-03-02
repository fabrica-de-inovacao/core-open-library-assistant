'use client';

/**
 * hooks/useChatOrchestration.ts
 * P-06: Extrai toda a lógica de orquestração do chat de page.tsx (era >730 linhas).
 *
 * Responsabilidades:
 * - Gerencia sessionQueryId, chatId, messages via useChat
 * - Controla estados de busca (runningSearches, zeroResults)
 * - Dispara generate_systematic_review quando artigos estão prontos
 * - Controla URL (replaceState para /workspace/chat/[chatId])
 * - Calcula activeQueryId, displayMessages, displayArticles, panelQueryId
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  UIMessage,
  DefaultChatTransport,
  isToolOrDynamicToolUIPart,
  getToolOrDynamicToolName,
} from 'ai';
import { useChat } from '@ai-sdk/react';
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime';

interface UseChatOrchestrationOptions {
  urlQueryId: string | undefined;
  initialMessages?: UIMessage[];
  isLoading?: boolean; // auth status loading
  authStatus: 'authenticated' | 'unauthenticated' | 'loading';
}

export function useChatOrchestration({
  urlQueryId,
  initialMessages,
  authStatus,
}: UseChatOrchestrationOptions) {
  // ── Session State ───────────────────────────────────────────────────────────

  const [sessionQueryId, setSessionQueryId] = useState<string | null>(urlQueryId ?? null);
  const sessionQueryIdRef = useRef<string | null>(urlQueryId ?? null);
  useEffect(() => {
    sessionQueryIdRef.current = sessionQueryId;
  }, [sessionQueryId]);

  // Stable chatId: gerado uma única vez, não muda durante a sessão
  const [chatId] = useState<string>(() => {
    if (urlQueryId) return urlQueryId;
    return typeof crypto !== 'undefined'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(7);
  });
  const chatIdRef = useRef<string>(chatId);

  // ── Transport ───────────────────────────────────────────────────────────────

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({ queryId: sessionQueryIdRef.current, chatId: chatIdRef.current }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── useChat ─────────────────────────────────────────────────────────────────

  const { messages, sendMessage, status, setMessages } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: chatTransport,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Stable ref para sendMessage (evita re-criação de closures em useEffects)
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // ── Search State ────────────────────────────────────────────────────────────

  const [runningSearches, setRunningSearches] = useState<Set<string>>(new Set());
  const [zeroResultSearches, setZeroResultSearches] = useState<Set<string>>(new Set());
  const [executedProposalIds, setExecutedProposalIds] = useState<Set<string>>(new Set());

  const handleExecuteSearch = useCallback(
    async (queries: string[], qId: string, isGlobal = false) => {
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/workspace/query/${qId}`);
      }
      setSessionQueryId(qId);
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

  // ── URL Management ──────────────────────────────────────────────────────────

  const isClearingRef = useRef(false);

  // Reset session ao navegar para /workspace (botão "Nova Busca")
  useEffect(() => {
    const isRootWorkspace =
      typeof window !== 'undefined' && window.location.pathname.endsWith('/workspace');

    if (!urlQueryId && isRootWorkspace && sessionQueryId) {
      isClearingRef.current = true;
      const timeoutId = setTimeout(() => {
        setSessionQueryId(null);
        setMessages([]);
        isClearingRef.current = false;
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [urlQueryId, sessionQueryId, setMessages]);

  // Fase 1 (P-01): URL estável baseada em chatId
  useEffect(() => {
    if (chatId && typeof window !== 'undefined' && !isClearingRef.current) {
      const currentPath = window.location.pathname;
      const targetPath = `/workspace/chat/${chatId}`;
      if (currentPath !== targetPath && !currentPath.startsWith('/workspace/chat/')) {
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, [chatId]);

  // ── Derived State ───────────────────────────────────────────────────────────

  // P-13: Memoizado com early-return para evitar O(n×m) scan em cada render
  const activeQueryId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg.parts) continue;
      for (const part of msg.parts) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        const toolName = getToolOrDynamicToolName(part);
        if (toolName !== 'search_sol_database' && toolName !== 'search_global_database') continue;
        if (part.state !== 'output-available') continue;
        const rawOutput = (part as any).output;
        const output = (rawOutput?.type === 'json' ? rawOutput.value : rawOutput) as {
          success: boolean;
          query_id?: string;
        };
        if (output?.success && output.query_id) return output.query_id;
      }
    }
    return sessionQueryId;
  }, [messages, sessionQueryId]);

  const hasZeroResults = useMemo(() => {
    if (!activeQueryId) return false;
    if (zeroResultSearches.has(activeQueryId)) return true;
    for (const msg of messages) {
      const toolParts = msg.parts?.filter(isToolOrDynamicToolUIPart) ?? [];
      for (const part of toolParts) {
        const toolName = getToolOrDynamicToolName(part);
        if (
          (toolName === 'search_sol_database' || toolName === 'search_global_database') &&
          part.state === 'output-available'
        ) {
          const output = (part as any).output as {
            success: boolean;
            query_id?: string;
            total_found?: number;
          };
          const inputData = (part as any).input as { query_id?: string };
          if (
            (output?.query_id || inputData?.query_id) === activeQueryId &&
            (!output?.success || (output.total_found !== undefined && output.total_found <= 5))
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
      m.parts
        ?.filter(isToolOrDynamicToolUIPart)
        .some(
          (p) =>
            (getToolOrDynamicToolName(p) === 'search_sol_database' ||
              getToolOrDynamicToolName(p) === 'search_global_database') &&
            p.state !== 'output-available'
        )
    );
  }, [messages, activeQueryId, runningSearches]);

  // P-15: [SISTEMA] mensagens filtradas para o chat UI
  const displayMessages = useMemo((): UIMessage[] => {
    return messages.filter((m) => {
      const textPart = m.parts?.find((p) => p.type === 'text') as
        | { type: 'text'; text: string }
        | undefined;
      return !(m.role === 'user' && textPart?.text.startsWith('[SISTEMA]'));
    });
  }, [messages]);

  // ── Articles (Supabase Realtime) ────────────────────────────────────────────

  const { data: articles, realtimeStatus } = useSupabaseRealtime(activeQueryId, chatId);

  const previousArticlesRef = useRef<any[]>([]);
  const previousQueryIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (articles && articles.length > 0) {
      previousArticlesRef.current = articles;
      previousQueryIdRef.current = activeQueryId;
    }
  }, [articles, activeQueryId]);

  const displayArticles = useMemo(() => {
    if (articles && articles.length > 0) return articles;
    if (isSearchRunning && previousArticlesRef.current.length > 0)
      return previousArticlesRef.current;
    return articles ?? [];
  }, [articles, isSearchRunning]);

  const panelQueryId =
    articles && articles.length > 0 ? activeQueryId : (previousQueryIdRef.current ?? activeQueryId);

  const hasArticles = displayArticles.length > 0;

  // ── Review Orchestration ────────────────────────────────────────────────────

  const reviewedQueryIdsRef = useRef<Set<string>>(new Set());
  const articleCountRef = useRef<any[]>([]);

  useEffect(() => {
    if (activeQueryId && typeof window !== 'undefined') {
      if (localStorage.getItem(`sol_review_done_${activeQueryId}`) === 'true') {
        reviewedQueryIdsRef.current.add(activeQueryId);
      }
    }
  }, [activeQueryId]);

  const onArticlesChange = useCallback(
    (currentArticles: any[]) => {
      articleCountRef.current = currentArticles;
      if (!activeQueryId || reviewedQueryIdsRef.current.has(activeQueryId) || isLoading) return;
      if (currentArticles.length === 0) return;

      // Guard de cross-contamination: artigos pertencem ao activeQueryId atual
      if (currentArticles.some((a: any) => a.queryId !== activeQueryId)) return;

      const TERMINAL = ['done', 'abstract_only', 'failed'];
      const allFinished = currentArticles.every((a: any) => TERMINAL.includes(a.status ?? ''));
      const hasContent = currentArticles.some(
        (a: any) => (a.status === 'done' || a.status === 'abstract_only') && a.tldrContent
      );

      if (allFinished && hasContent && !reviewedQueryIdsRef.current.has(activeQueryId)) {
        reviewedQueryIdsRef.current.add(activeQueryId);
        if (typeof window !== 'undefined') {
          localStorage.setItem(`sol_review_done_${activeQueryId}`, 'true');
        }

        const lowResultsHint =
          currentArticles.length <= 5
            ? ' (Poucos resultados encontrados. ALÉM do resumo, sugira IMEDIATAMENTE a busca global com propose_search_global_database)'
            : '';

        // P-04: generate_systematic_review usa chatId da closure — sem query_id aqui
        setTimeout(() => {
          sendMessageRef.current({
            text: `[SISTEMA] Todos os artigos foram processados. Por favor, gere agora a revisão sistemática consolidada chamando a ferramenta generate_systematic_review.${lowResultsHint}`,
          });
        }, 100);
      }
    },
    [activeQueryId, isLoading]
  );

  useEffect(() => {
    onArticlesChange(articles);
  }, [articles, onArticlesChange]);

  // Auto-sugestão de busca global quando zero resultados na SOL
  useEffect(() => {
    if (hasZeroResults && activeQueryId && !reviewedQueryIdsRef.current.has(activeQueryId)) {
      reviewedQueryIdsRef.current.add(activeQueryId);
      const t = setTimeout(() => {
        sendMessageRef.current({
          text: `[SISTEMA] A busca na base SOL retornou poucos resultados (<= 5) ou falhou. Sugira IMEDIATAMENTE ao usuário tentar a busca na base global (OpenAlex) chamando a tool propose_search_global_database.`,
        });
      }, 500);
      return () => clearTimeout(t);
    }
  }, [hasZeroResults, activeQueryId]);

  // P-14: Safety net 60s com cleanup correto para evitar memory leak após navegação
  const zeroResultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeQueryId || isLoading || hasZeroResults) return;
    zeroResultsTimerRef.current = setTimeout(() => {
      if (articleCountRef.current.length === 0 && !reviewedQueryIdsRef.current.has(activeQueryId)) {
        reviewedQueryIdsRef.current.add(activeQueryId);
        sendMessageRef.current({
          text: `[SISTEMA] A busca para a query ${activeQueryId} foi concluída mas nenhum artigo foi encontrado ou processado.`,
        });
      }
    }, 60_000);
    return () => {
      if (zeroResultsTimerRef.current) clearTimeout(zeroResultsTimerRef.current);
    };
  }, [activeQueryId, isLoading, hasZeroResults]);

  return {
    // Chat
    messages,
    displayMessages,
    sendMessage,
    setMessages,
    isLoading,
    chatId,
    // Queries
    sessionQueryId,
    setSessionQueryId,
    activeQueryId,
    handleExecuteSearch,
    executedProposalIds,
    runningSearches,
    // Articles
    articles,
    displayArticles,
    panelQueryId,
    hasArticles,
    realtimeStatus,
    articleCountRef,
    // Flags
    hasZeroResults,
    isSearchRunning,
  };
}

'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/refs */

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
import { usePathname } from 'next/navigation';
import {
  type UIMessage,
  DefaultChatTransport,
  isToolOrDynamicToolUIPart,
  getToolOrDynamicToolName,
} from 'ai';
import { useChat } from '@ai-sdk/react';
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime';

// Fase 3 (P-chips): chips de sugestão rápida exibidos no input quando needs_refinement
export type SuggestionChip = { label: string; icon: string; message: string };

// Fase C (IA-04): modo de síntese selecionável pelo usuário
export type SynthesisMode = 'auto' | 'quick' | 'systematic';

// Chips de override manual — a IA já tenta o próximo passo automaticamente,
// mas o usuário pode forçar uma estratégia específica clicando nos chips.
const NEEDS_REFINEMENT_CHIPS: SuggestionChip[] = [
  {
    label: 'Forçar nova busca SOL',
    icon: '🔍',
    message:
      'Proponha uma nova busca na base SOL com termos mais amplos e abrangentes do que os anteriores',
  },
  {
    label: 'Ir direto ao OpenAlex',
    icon: '🌐',
    message: 'Proponha agora uma busca na base global OpenAlex para ampliar o corpus',
  },
  {
    label: 'Redefinir abordagem',
    icon: '🔄',
    message: 'Vamos repensar a abordagem da pesquisa e definir um novo ângulo',
  },
];

interface UseChatOrchestrationOptions {
  urlQueryId: string | undefined;
  initialMessages?: UIMessage[];
  isLoading?: boolean; // auth status loading
  authStatus: 'authenticated' | 'unauthenticated' | 'loading';
  /** P-22: ID do modelo selecionado pelo usuário (ex: "gemini-2.5-flash") */
  modelId?: string;
  /** Override do limite de artigos por busca — sobropõe sol-settings.articlesPerSearch quando definido */
  searchLimitOverride?: number;
  /**
   * Fase C (IA-04): modo de síntese explícito selecionado pelo usuário na UI.
   * 'auto'       → RouterAgent decide automaticamente (padrão)
   * 'quick'      → força quick_lookup + síntese brief/standard
   * 'systematic' → força systematic_review + síntese full
   */
  initialSynthesisMode?: SynthesisMode;
}

export function useChatOrchestration({
  urlQueryId,
  initialMessages,
  modelId,
  searchLimitOverride,
  initialSynthesisMode = 'auto',
}: UseChatOrchestrationOptions) {
  // ── Pathname tracking (navegação intencional) ──────────────────────────────
  // Fase 1 (P-01-fix): detecta quando o utilizador navega intencionalmente
  // para fora do chat via sidebar, para não sobrescrever a URL com replaceState.
  const pathname = usePathname();
  const prevPathnameRef = useRef<string>(pathname);
  // Flag: true enquanto o utilizador está numa rota que não é o chat atual
  const navAwayFromChatRef = useRef<boolean>(false);

  // Efeito sem deps: corre após cada render para rastrear mudanças de pathname.
  // Declarado ANTES do efeito de URL para garantir que o flag é actualizado primeiro.
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    // Veio de uma rota de chat e saiu → navegação intencional
    if (prev.startsWith('/workspace/chat/') && !pathname.startsWith('/workspace/chat/')) {
      navAwayFromChatRef.current = true;
    }
    // Voltou para uma rota de chat → resetar flag
    if (pathname.startsWith('/workspace/chat/')) {
      navAwayFromChatRef.current = false;
    }
  });

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

  // P-22: ref para o modelId (permite que o body da request use sempre o valor mais recente)
  const modelIdRef = useRef<string | undefined>(modelId);
  useEffect(() => {
    modelIdRef.current = modelId;
  }, [modelId]);

  // Ref para searchLimitOverride — evita re-criação de closures em callbacks de busca
  const searchLimitOverrideRef = useRef<number | undefined>(searchLimitOverride);
  useEffect(() => {
    searchLimitOverrideRef.current = searchLimitOverride;
  }, [searchLimitOverride]);
  // Fase C (IA-04): modo de síntese selecionável pelo usuário
  const [synthesisMode, setSynthesisMode] = useState<SynthesisMode>(initialSynthesisMode);
  const synthesisModeRef = useRef<SynthesisMode>(initialSynthesisMode);
  useEffect(() => {
    synthesisModeRef.current = synthesisMode;
  }, [synthesisMode]);
  // ── Transport ─────────────────────────────────────────────────────────────────────────

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          queryId: sessionQueryIdRef.current,
          chatId: chatIdRef.current,
          // P-22: inclui modelId quando selecionado
          ...(modelIdRef.current ? { modelId: modelIdRef.current } : {}),
          // Fase C (IA-04): modo de síntese (undefined = auto, passa para o router decidir)
          ...(synthesisModeRef.current !== 'auto'
            ? { userSynthesisMode: synthesisModeRef.current }
            : {}),
        }),
      }),

    []
  );

  // ── useChat ─────────────────────────────────────────────────────────────────

  const { messages, sendMessage, stop, status, setMessages } = useChat({
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
  // Fase 3 (P-chips): chips de ação rápida exibidos no input após needs_refinement
  const [suggestionChips, setSuggestionChips] = useState<SuggestionChip[] | null>(null);
  const clearSuggestionChips = useCallback(() => setSuggestionChips(null), []);
  /**
   * Fase C (IA-04) — Automação de fallback de busca.
   * Conta quantas vezes a busca falhou (needs_refinement) nesta sessão.
   *   0 → nunca falhou
   *   1 → 1ª falha: AI relança propose_search_sol_database automaticamente (termos mais amplos)
   *   2+ → 2ª+ falha: AI escala automaticamente para propose_search_global_database
   * Resetado quando uma busca conclui com sucesso (queryStatus=done).
   */
  const solSearchFailureCountRef = useRef<number>(0);
  // Fase 3 (P-23): IDs executados na sessão atual (complementado pela derivação abaixo)
  const [localExecutedIds, setLocalExecutedIds] = useState<Set<string>>(new Set());

  // Deriva executedProposalIds: combina IDs da sessão + IDs de buscas já presentes
  // nas mensagens carregadas do DB, para que cards executados apareçam corretos após reload.
  const executedProposalIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>(localExecutedIds);
    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        if (
          isToolOrDynamicToolUIPart(part) &&
          (getToolOrDynamicToolName(part) === 'search_sol_database' ||
            getToolOrDynamicToolName(part) === 'search_global_database')
        ) {
          const queryId = (part as any).input?.query_id;
          if (queryId) ids.add(queryId);
        }
      }
    }
    return ids;
  }, [messages, localExecutedIds]);

  const handleExecuteSearch = useCallback(
    async (queries: string[], qId: string, isGlobal = false) => {
      // P-01: URL permanece em /workspace/chat/[chatId] — queryId não vai para a URL
      // Fase 3 (P-chips): nova busca iniciada → descarta chips anteriores
      setSuggestionChips(null);
      setSessionQueryId(qId);
      setLocalExecutedIds((prev) => new Set(prev).add(qId));
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

        // Fase 7 (P-settings): injeta preferências do usuário na requisição de busca
        // searchLimitOverrideRef tem prioridade sobre sol-settings.articlesPerSearch
        try {
          const stored = JSON.parse(localStorage.getItem('sol-settings') ?? '{}') as {
            articlesPerSearch?: number;
            tldrLanguage?: string;
          };
          const effectiveLimit = searchLimitOverrideRef.current ?? stored.articlesPerSearch;
          if (effectiveLimit) params.append('limit', String(effectiveLimit));
          if (stored.tldrLanguage) params.append('tldr_lang', stored.tldrLanguage);
        } catch {
          /* localStorage indisponível — usa defaults do servidor */
        }

        const res = await fetch(`${searchEndPoint}?${params.toString()}`);
        const data = (await res.json()) as {
          success: boolean;
          total_found?: number;
          needs_refinement?: boolean;
          reason?: string;
        };

        // needs_refinement: poucos resultados (<5) — Inngest não foi acionado.
        // Tratado aqui diretamente (não via Realtime de search_queries) para garantir
        // resposta imediata independente de Supabase Realtime estar habilitado na tabela.
        if (data.needs_refinement) {
          setRunningSearches((prev) => {
            const n = new Set(prev);
            n.delete(qId);
            return n;
          });
          reviewedQueryIdsRef.current.add(qId);

          // Fase C (IA-04): automação de fallback — AI age sozinha, notifica o usuário.
          // Chips ficam visíveis como override manual caso o usuário queira controlar.
          solSearchFailureCountRef.current += 1;
          const failCount = solSearchFailureCountRef.current;
          setSuggestionChips(NEEDS_REFINEMENT_CHIPS);

          setTimeout(() => {
            if (failCount === 1) {
              // 1ª falha: AI relança SOL automaticamente com termos diversificados
              sendMessageRef.current({
                text: `[SISTEMA] A busca SOL retornou apenas ${data.total_found ?? 0} resultado(s) — insuficiente para revisão sistemática. Chame IMEDIATAMENTE propose_search_sol_database com o MESMO tópico da conversa e queries:[]. O agente de estratégia já tem acesso ao histórico de buscas anteriores desta sessão e irá diversificar os termos automaticamente. Antes de chamar a tool, escreva EXATAMENTE UMA frase curta em Português informando ao usuário: (1) quantos resultados foram encontrados, (2) que você está tentando automaticamente com uma estratégia mais ampla. NÃO use essa frase de forma genérica — mencione o número exato de resultados.`,
              });
            } else {
              // 2ª+ falha: AI escala para OpenAlex automaticamente
              sendMessageRef.current({
                text: `[SISTEMA] Após ${failCount} tentativas na base SOL sem resultados suficientes para o tema, chame IMEDIATAMENTE propose_search_global_database com o tópico da conversa em inglês/conceitos. Antes de chamar a tool, escreva EXATAMENTE DUAS frases em Português: (1) diga quantas tentativas foram feitas na SOL e que nenhuma trouxe artigos suficientes, (2) explique que você está expandindo automaticamente para a base global OpenAlex (+250 milhões de artigos científicos).`,
              });
            }
          }, 300);
          return;
        }

        // Fix feedback: NÃO limpa runningSearches aqui.
        // O Inngest processa de forma assíncrona — os artigos chegam via Realtime
        // segundos depois. runningSearches é limpo quando o primeiro artigo chega
        // (ver useEffect de articles abaixo), evitando o gap sem indicador visual.

        if (!data.success || data.total_found === 0) {
          // Busca sem resultado: limpa imediatamente (nenhum artigo vai chegar)
          setRunningSearches((prev) => {
            const n = new Set(prev);
            n.delete(qId);
            return n;
          });
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
  // Só redireciona quando a sessão de facto começou (há mensagens ou uma query ativa).
  // Evita substituir /workspace por /workspace/chat/[id] ao entrar na home sem fazer nada.
  // P-01-fix: não sobrescreve a URL se o utilizador navegou intencionalmente para fora do chat
  // (ex: clicou na sidebar para ir ao /workspace ou /workspace/history).
  useEffect(() => {
    const sessionStarted = messages.length > 0 || sessionQueryId !== null;
    if (!sessionStarted || !chatId || typeof window === 'undefined' || isClearingRef.current)
      return;

    // Respeitar navegação intencional do utilizador — não anular o roteamento do Next.js
    if (navAwayFromChatRef.current) return;

    const currentPath = window.location.pathname;
    const targetPath = `/workspace/chat/${chatId}`;
    if (currentPath !== targetPath && !currentPath.startsWith('/workspace/chat/')) {
      window.history.replaceState(null, '', targetPath);
    }
  }, [chatId, messages.length, sessionQueryId]);

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

  const {
    data: articles,
    realtimeStatus,
    addQueryId: addWatchedQueryId,
    refreshByChatId: refreshArticles,
    queryStatus,
  } = useSupabaseRealtime(activeQueryId, chatId);

  const previousArticlesRef = useRef<any[]>([]);
  const previousQueryIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (articles && articles.length > 0) {
      previousArticlesRef.current = articles;
      previousQueryIdRef.current = activeQueryId;
      // Fix feedback: limpa runningSearches quando os primeiros artigos chegam via Realtime.
      // Isso elimina o gap visual entre o retorno da API e os INSERTs do Inngest.
      if (activeQueryId) {
        setRunningSearches((prev) => {
          if (!prev.has(activeQueryId)) return prev; // sem mudança desnecessária
          const n = new Set(prev);
          n.delete(activeQueryId);
          return n;
        });
      }
    }
  }, [articles, activeQueryId]);

  const displayArticles = useMemo(() => {
    // P-rerank: aplica o mesmo score composto (citações + recência) usado no backend
    // para que o painel reflita a mesma ordem da revisão sistemática.
    // Fórmula: S = 0.6·log(1+cit)/log(501) + 0.4·1/(1+age)
    // Artigos "done" são ordenados pelo score; artigos em processamento ficam no fim.
    const CURRENT_YEAR = new Date().getFullYear();
    const rank = (a: {
      citationCount?: number | null;
      publicationYear?: number | null;
      status?: string | null;
    }) => {
      const TERMINAL = ['done', 'abstract_only'];
      if (!TERMINAL.includes(a.status ?? '')) return -1; // processando → fim da lista
      const impact = Math.log1p(Math.max(0, a.citationCount ?? 0)) / Math.log1p(500);
      const age = Math.max(0, CURRENT_YEAR - (a.publicationYear ?? 0));
      const recency = a.publicationYear ? 1 / (1 + age) : 0;
      return 0.6 * impact + 0.4 * recency;
    };
    const sorted = (arr: typeof articles) => [...(arr ?? [])].sort((a, b) => rank(b) - rank(a));

    if (articles && articles.length > 0) return sorted(articles);
    if (isSearchRunning && previousArticlesRef.current.length > 0)
      return sorted(previousArticlesRef.current);
    return articles ?? [];
  }, [articles, isSearchRunning]);

  const panelQueryId =
    articles && articles.length > 0 ? activeQueryId : (previousQueryIdRef.current ?? activeQueryId);

  const hasArticles = displayArticles.length > 0;

  /**
   * P-23: Histórico de queries — lista de grupos de artigos por queryId.
   * Cada entrada contém: queryId, topic (da ferramenta propose_*), totalCount, doneCount, isRunning.
   * Usado pelo QueryHistoryBar no workspace.
   */
  const queryGroups = useMemo(() => {
    // Monta mapa queryId → tópico varrendo tool outputs de proposta
    const topicMap = new Map<string, string>();
    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        const toolName = getToolOrDynamicToolName(part);
        if (
          toolName !== 'propose_search_sol_database' &&
          toolName !== 'propose_search_global_database'
        )
          continue;
        if (part.state !== 'output-available') continue;
        const output = (part as any).output;
        const qId = output?.query_id ?? output?.value?.query_id;
        if (!qId) continue;
        const input = (part as any).input as { topic?: string; queries?: string[] };
        const finalOutput = output?.type === 'json' ? output.value : output;
        const topic =
          input?.topic || finalOutput?.queries?.[0] || input?.queries?.[0] || 'Pesquisa';
        topicMap.set(qId, String(topic).slice(0, 80));
      }
    }

    // Agrupa articles por queryId
    const groupMap = new Map<
      string,
      {
        queryId: string;
        topic: string;
        totalCount: number;
        doneCount: number;
        isRunning: boolean;
      }
    >();

    for (const article of articles ?? []) {
      const qId = (article as any).queryId;
      if (!qId) continue;
      if (!groupMap.has(qId)) {
        groupMap.set(qId, {
          queryId: qId,
          topic: topicMap.get(qId) ?? 'Pesquisa',
          totalCount: 0,
          doneCount: 0,
          isRunning: runningSearches.has(qId),
        });
      }
      const g = groupMap.get(qId)!;
      g.totalCount++;
      const status = (article as any).status;
      if (status === 'done' || status === 'abstract_only') g.doneCount++;
    }

    return Array.from(groupMap.values());
  }, [messages, articles, runningSearches]);

  // ── Review Orchestration ────────────────────────────────────────────────────

  const reviewedQueryIdsRef = useRef<Set<string>>(new Set());
  const articleCountRef = useRef<any[]>([]);

  // Cancela uma busca em progresso: actualiza DB via API + para o Inngest job
  const handleCancelSearch = useCallback(async (qId: string) => {
    // Remove imediatamente do estado visual (não bloqueia na espera da API)
    setRunningSearches((prev) => {
      const n = new Set(prev);
      n.delete(qId);
      return n;
    });
    // Previne que a auto-síntese dispare para esta query cancelada
    reviewedQueryIdsRef.current.add(qId);
    try {
      await fetch('/api/search/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_id: qId }),
      });
    } catch (err) {
      console.error('[UI] Erro ao cancelar busca:', err);
    }
  }, []);

  useEffect(() => {
    if (activeQueryId && typeof window !== 'undefined') {
      if (localStorage.getItem(`sol_review_done_${activeQueryId}`) === 'true') {
        reviewedQueryIdsRef.current.add(activeQueryId);
      }
    }
  }, [activeQueryId]);

  const onArticlesChange = useCallback((currentArticles: any[]) => {
    // Mantém ref atualizada para uso nos effects de síntese e diagnóstico.
    // A síntese agora é disparada pelo queryStatus (ver useEffect abaixo),
    // não pelo status dos artigos no cliente — evita disparô prematuramente
    // quando o Inngest processa em múltiplos batches sequenciais.
    articleCountRef.current = currentArticles;
  }, []);

  useEffect(() => {
    onArticlesChange(articles);
  }, [articles, onArticlesChange]);

  // Dispara síntese ou mensagem de refinamento baseado no status REAL da query no DB.
  // RAZÃO: o Inngest processa artigos em batches de 3. Quando o batch 1 terminava com
  //        todos seus artigos prontos, o trigger anterior (via status de artigos no cliente)
  //        disparava a síntese ANTES do batch 2 começar. Usar searchQueries.status = 'done'
  //        (setado pelo Inngest apenas após verificar TODOS os batches) garante que a
  //        síntese só ocorre quando tudo está genuinamente pronto.
  useEffect(() => {
    if (!activeQueryId || !queryStatus) return;
    if (reviewedQueryIdsRef.current.has(activeQueryId)) return;

    if (queryStatus === 'done') {
      reviewedQueryIdsRef.current.add(activeQueryId);
      // Fase C (IA-04): busca bem-sucedida — reseta contador de falhas
      solSearchFailureCountRef.current = 0;
      if (typeof window !== 'undefined') {
        localStorage.setItem(`sol_review_done_${activeQueryId}`, 'true');

        // Fase 7 (P-settings): notificação do browser se o utilizador ativou a opção
        try {
          const stored = JSON.parse(localStorage.getItem('sol-settings') ?? '{}') as {
            browserNotifications?: boolean;
          };
          if (stored.browserNotifications && Notification.permission === 'granted') {
            new Notification('SOL O.L.A.', {
              body: 'Seus artigos foram processados. A revisão sistemática está pronta!',
              icon: '/favicon.ico',
            });
          }
        } catch {
          /* Notification API indisponível */
        }
      }

      const currentArts = articleCountRef.current ?? [];
      const hasContent = currentArts.some(
        (a: any) =>
          a.queryId === activeQueryId &&
          (a.status === 'done' || a.status === 'abstract_only') &&
          a.tldrContent
      );
      if (!hasContent) return; // sem artigos com TL;DR — não gera síntese

      const isIncremental = currentArts.some((a: any) => a.queryId !== activeQueryId);

      setTimeout(() => {
        if (isIncremental) {
          const cnt = currentArts.filter((a: any) => a.queryId === activeQueryId).length;
          sendMessageRef.current({
            text: `[SISTEMA] A busca adicional foi concluída: ${cnt} novo(s) artigo(s) processado(s). Chame generate_systematic_review e gere uma análise incremental CURTA (máx. 3 parágrafos) destacando o que os novos artigos confirmam, contradizem ou complementam em relação à síntese anterior. NÃO replique toda a revisão anterior — foque apenas nas novas contribuições.`,
          });
        } else {
          sendMessageRef.current({
            text: `[SISTEMA] Todos os artigos foram processados. Por favor, gere agora a revisão sistemática consolidada chamando a ferramenta generate_systematic_review.`,
          });
        }
      }, 500);
      return;
    }

    if (queryStatus === 'needs_refinement') {
      reviewedQueryIdsRef.current.add(activeQueryId);
      // Limpa indicador de busca em progresso
      setRunningSearches((prev) => {
        const n = new Set(prev);
        n.delete(activeQueryId);
        return n;
      });

      // Fase C (IA-04): mesma lógica de automação da falha via API.
      // Este caminho é acionado pelo Supabase Realtime após o RelevanceGate do Inngest.
      solSearchFailureCountRef.current += 1;
      const failCount = solSearchFailureCountRef.current;
      setSuggestionChips(NEEDS_REFINEMENT_CHIPS);
      setTimeout(() => {
        if (failCount === 1) {
          // 1ª falha (RelevanceGate rejeitou): AI relança SOL automaticamente
          sendMessageRef.current({
            text: `[SISTEMA] Os artigos encontrados não têm relevância suficiente para o tema (rejeitados pelo gate de qualidade). Chame IMEDIATAMENTE propose_search_sol_database com o MESMO tópico da conversa e queries:[]. O agente de estratégia já sabe quais queries foram usadas e vai diversificar os termos. Antes de chamar a tool, escreva EXATAMENTE UMA frase curta em Português informando ao usuário que os artigos encontrados não eram relevantes e que você está tentando automaticamente com uma estratégia diferente.`,
          });
        } else {
          // 2ª+ falha: AI escala para OpenAlex automaticamente
          sendMessageRef.current({
            text: `[SISTEMA] Após ${failCount} tentativas na base SOL sem resultados relevantes para o tema, chame IMEDIATAMENTE propose_search_global_database com o tópico da conversa em inglês/conceitos. Antes de chamar a tool, escreva EXATAMENTE DUAS frases em Português: (1) mencione que após várias tentativas a SOL não encontrou artigos suficientemente relevantes, (2) explique que está expandindo automaticamente para a base global OpenAlex (+250 milhões de artigos científicos).`,
          });
        }
      }, 300);
    }
  }, [activeQueryId, queryStatus]);

  // Auto-sugestão de busca global quando zero resultados na SOL
  useEffect(() => {
    if (hasZeroResults && activeQueryId && !reviewedQueryIdsRef.current.has(activeQueryId)) {
      reviewedQueryIdsRef.current.add(activeQueryId);
      const t = setTimeout(() => {
        sendMessageRef.current({
          text: `[SISTEMA] A busca no acervo SOL não retornou resultados para o tema solicitado. Chame IMEDIATAMENTE a tool propose_search_global_database. Depois, escreva 2 frases curtas para o usuário: (1) explique que o acervo SOL não encontrou artigos para esse tema, e (2) diga que está propondo uma busca na base global OpenAlex, que indexa +250 milhões de trabalhos científicos.`,
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
    stop,
    setMessages,
    isLoading,
    chatId,
    // Queries
    sessionQueryId,
    setSessionQueryId,
    activeQueryId,
    handleExecuteSearch,
    handleCancelSearch,
    executedProposalIds,
    runningSearches,
    // Articles
    articles,
    displayArticles,
    panelQueryId,
    hasArticles,
    queryGroups,
    realtimeStatus,
    articleCountRef,
    // Fase 3 (P-PDF/P-DOI): subscrever realtime de uploads e refresh manual
    addWatchedQueryId,
    refreshArticles,
    // Flags
    hasZeroResults,
    isSearchRunning,
    // Fase 3 (P-chips): chips de ação rápida
    suggestionChips,
    clearSuggestionChips,
    // Fase C (IA-04): modo de síntese
    synthesisMode,
    setSynthesisMode,
  };
}

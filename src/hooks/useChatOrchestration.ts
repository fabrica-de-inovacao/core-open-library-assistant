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
import { supabase } from '@/lib/supabase';
import { rankArticles, type Article } from '@/lib/reranking';

// Fase C (IA-04): modo de síntese selecionável pelo usuário
export type SynthesisMode = 'auto' | 'quick' | 'systematic';

// ── Helpers internos ──────────────────────────────────────────────────────────

/** Normaliza output de tool part — desencapsula o wrapper `{type:'json', value:...}` do AI SDK */
function normalizeToolOutput(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return r.type === 'json' ? (r.value as Record<string, unknown>) : r;
}

/** Extrai query_id do output de propose_search_* — DRY para os 3 locais de auto-execução */
function extractQueryId(rawOutput: unknown): string | undefined {
  const o = normalizeToolOutput(rawOutput);
  return typeof o?.query_id === 'string' ? o.query_id : undefined;
}

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

  // Stable ref para refreshArticles — populado após useSupabaseRealtime estar disponível
  // Necessário para re-fetch de artigos dentro do handleExecuteSearch (useCallback com [])
  const refreshArticlesRef = useRef<(() => Promise<void>) | null>(null);

  // ── Search State ────────────────────────────────────────────────────────────

  const [runningSearches, setRunningSearches] = useState<Set<string>>(new Set());
  const [zeroResultSearches, setZeroResultSearches] = useState<Set<string>>(new Set());

  /**
   * Fase C (IA-04) — Automação de fallback de busca.
   * Conta quantas vezes a busca falhou (needs_refinement) nesta sessão.
   *   0 → nunca falhou
   *   1 → 1ª falha: AI relança propose_search_sol_database automaticamente (termos mais amplos)
   *   2+ → 2ª+ falha: AI escala automaticamente para propose_search_global_database
   * Resetado quando uma busca conclui com sucesso (queryStatus=done).
   */
  const solSearchFailureCountRef = useRef<number>(0);
  // Fase C (A-5): guard idempotente — garante que cada queryId seja contado apenas uma vez
  // mesmo que Realtime e resposta da API disparem simultaneamente.
  const failureCountedRef = useRef<Set<string>>(new Set());
  // Fase 3 (P-23): IDs executados na sessão atual (complementado pela derivação abaixo)
  const [localExecutedIds, setLocalExecutedIds] = useState<Set<string>>(new Set());

  // Deriva executedProposalIds: combina IDs da sessão com IDs carregados do DB
  // via useEffect abaixo (à frente no arquivo, após articles estar disponível).
  const executedProposalIds = useMemo<Set<string>>(() => {
    return new Set<string>(localExecutedIds);
  }, [localExecutedIds]);

  const handleExecuteSearch = useCallback(
    async (queries: string[], qId: string, isGlobal = false) => {
      // P-01: URL permanece em /workspace/chat/[chatId] — queryId não vai para a URL
      setSessionQueryId(qId);
      sessionQueryIdRef.current = qId; // Fase C: sincroniza ref imediatamente — elimina setTimeout(300)
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
          // Fase C (A-5): guard idempotente — evita duplo incremento se Realtime e API
          // responserem para o mesmo qId quase simultaneamente.
          if (!failureCountedRef.current.has(qId)) {
            failureCountedRef.current.add(qId);
            solSearchFailureCountRef.current += 1;
          }
          const failCount = solSearchFailureCountRef.current;

          // Fase C: ref já sincronizada acima — chamada direta sem setTimeout
          if (failCount === 1) {
            // 1ª falha: AI relança SOL automaticamente com termos diversificados
            sendMessageRef.current({
              text: `[SISTEMA] A busca SOL retornou apenas ${data.total_found ?? 0} resultado(s) — insuficiente para revisão sistemática. Chame IMEDIATAMENTE propose_search_sol_database com o MESMO tópico da conversa e queries:[]. O agente de estratégia já tem acesso ao histórico de buscas anteriores desta sessão e irá diversificar os termos automaticamente. NÃO escreva nada — chame a tool diretamente.`,
            });
          } else {
            // 2ª+ falha: AI escala para OpenAlex automaticamente
            sendMessageRef.current({
              text: `[SISTEMA] Após ${failCount} tentativas na base SOL sem resultados suficientes para o tema, chame IMEDIATAMENTE propose_search_global_database com o tópico da conversa em inglês/conceitos. NÃO escreva nada — chame a tool diretamente.`,
            });
          }
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
        } else {
          // Fase (P-14-fix): Re-fetch artigos após busca bem-sucedida para garantir que
          // a UI receba os artigos mesmo que o Realtime tenha perdido os INSERTs
          // (race condition entre fetchInitial e o commit dos INSERTs no Supabase).
          setTimeout(() => {
            void refreshArticlesRef.current?.();
          }, 1_500);
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

  // ── Auto-execute: nova proposta → executa sem aguardar clique do usuário ──
  // Fase IA-04: elimina a camada redundante de confirmação manual ("Executar Busca").
  // O card SearchProposalCard continua visível mas agora em modo informativo (somente leitura).
  //
  // pendingAutoExecuteRef é pré-populado com query_ids dos initialMessages para evitar
  // re-execução de buscas antigas ao recarregar uma sessão do histórico no DB.
  const pendingAutoExecuteRef = useRef<Set<string>>(
    (() => {
      const ids = new Set<string>();
      for (const msg of initialMessages ?? []) {
        for (const part of (msg as { parts?: unknown[] }).parts ?? []) {
          if (!isToolOrDynamicToolUIPart(part as any)) continue;
          const name = getToolOrDynamicToolName(part as any);
          if (name !== 'propose_search_sol_database' && name !== 'propose_search_global_database')
            continue;
          if ((part as { state?: string }).state !== 'output-available') continue;
          const qId = extractQueryId((part as { output?: unknown }).output);
          if (qId) ids.add(qId);
        }
      }
      return ids;
    })()
  );

  useEffect(() => {
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
        const finalOutput = normalizeToolOutput((part as any).output);
        const qId = finalOutput?.query_id as string | undefined;
        if (!qId) continue;
        if (executedProposalIds.has(qId) || pendingAutoExecuteRef.current.has(qId)) continue;

        // Nova proposta não executada → auto-executar imediatamente
        pendingAutoExecuteRef.current.add(qId);
        const queries = Array.isArray(finalOutput?.queries)
          ? (finalOutput.queries as string[])
          : typeof finalOutput?.query === 'string'
            ? [finalOutput.query as string]
            : [];
        // Fase (P-19-fix): NÃO pré-marcar global em reviewedQueryIdsRef —
        // a pré-marcação bloqueava a síntese automática ao impedir o useEffect
        // de queryStatus=done de processar o qId da busca global.
        // O loop foi corrigido na raiz (typeof query === 'string'), tornando
        // a pré-marcação desnecessária.
        void handleExecuteSearch(queries, qId, toolName === 'propose_search_global_database');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, executedProposalIds]);

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
        if (
          toolName !== 'propose_search_sol_database' &&
          toolName !== 'propose_search_global_database'
        )
          continue;
        if (part.state !== 'output-available') continue;
        const output = normalizeToolOutput((part as any).output) as
          | {
              success: boolean;
              query_id?: string;
            }
          | undefined;
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
          (toolName === 'propose_search_sol_database' ||
            toolName === 'propose_search_global_database') &&
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
            (getToolOrDynamicToolName(p) === 'propose_search_sol_database' ||
              getToolOrDynamicToolName(p) === 'propose_search_global_database') &&
            p.state !== 'output-available'
        )
    );
  }, [messages, activeQueryId, runningSearches]);

  // P-15: filtra mensagens [SISTEMA] (instruções internas) e textos gerados após proposal
  // tool calls (o SearchJourneyCard já é a UI canônica; o prompt proíbe texto após tools).
  // Regra determinística — sem heurísticas de tamanho ou conteúdo.
  //
  // ATENÇÃO: usa abordagem iterativa (result.at(-1)) em vez de visible[idx-1].
  // O motivo: quando visible contém uma mensagem vazia (step[1] de request anterior)
  // que seria suprimida, ela ainda aparece como `prev` para a mensagem seguinte se
  // usarmos índice — causando o "header vazio" antes do card de proposta.
  const displayMessages = useMemo((): UIMessage[] => {
    const visible = messages.filter((m) => {
      if (m.role !== 'user') return true;
      const text = (m.parts?.find((p) => p.type === 'text') as any)?.text ?? '';
      return !text.startsWith('[SISTEMA]');
    });

    const result: UIMessage[] = [];
    for (const m of visible) {
      if (m.role !== 'assistant') {
        result.push(m);
        continue;
      }
      // Mensagem com tool calls → pode precisar de merge
      const mTools = m.parts?.filter(isToolOrDynamicToolUIPart) ?? [];
      if (mTools.length > 0) {
        const hasProposal = mTools.some((p) => {
          const n = getToolOrDynamicToolName(p);
          return n === 'propose_search_sol_database' || n === 'propose_search_global_database';
        });

        if (hasProposal) {
          const lastShown = result.at(-1);
          if (lastShown && lastShown.role === 'assistant') {
            const lastHasProposal = (lastShown.parts?.filter(isToolOrDynamicToolUIPart) ?? []).some(
              (p) => {
                const n = getToolOrDynamicToolName(p);
                return (
                  n === 'propose_search_sol_database' || n === 'propose_search_global_database'
                );
              }
            );

            if (lastHasProposal) {
              // Merge m into lastShown
              const mergedParts = [...(lastShown.parts || [])];
              for (const part of m.parts || []) {
                if (part.type === 'text') {
                  const lastTextIdx = mergedParts.findIndex((p) => p.type === 'text');
                  if (lastTextIdx >= 0) {
                    const existing = mergedParts[lastTextIdx] as any;
                    const newText = existing.text.trim()
                      ? existing.text + '\n\n' + part.text
                      : part.text;
                    mergedParts[lastTextIdx] = { ...existing, text: newText };
                  } else {
                    mergedParts.push(part);
                  }
                } else {
                  mergedParts.push(part);
                }
              }

              const msgParsed = m as any;
              const lastParsed = lastShown as any;
              const mergedInvocations = [
                ...(lastParsed.toolInvocations || []),
                ...(msgParsed.toolInvocations || []),
              ];

              result[result.length - 1] = {
                ...lastShown,
                parts: mergedParts,
                toolInvocations: mergedInvocations.length > 0 ? mergedInvocations : undefined,
              } as UIMessage;

              continue;
            }
          }
        }

        result.push(m);
        continue;
      }
      // Texto/vazio sem tool calls: ocultar se a ÚLTIMA mensagem JÁ EXIBIDA do
      // assistente tem proposal call. Usa result.at(-1) — não visible[idx-1] —
      // para não tomar mensagens suprimidas como referência de "prev".
      const lastShown = result.at(-1);
      if (!lastShown || lastShown.role !== 'assistant') {
        result.push(m);
        continue;
      }
      const prevHasProposal = (lastShown.parts?.filter(isToolOrDynamicToolUIPart) ?? []).some(
        (p) => {
          const n = getToolOrDynamicToolName(p);
          return n === 'propose_search_sol_database' || n === 'propose_search_global_database';
        }
      );
      if (!prevHasProposal) result.push(m);
      // else: suprime — não adiciona ao result
    }
    return result;
  }, [messages]);

  // ── Articles (Supabase Realtime) ────────────────────────────────────────────

  const {
    data: articles,
    realtimeStatus,
    addQueryId: addWatchedQueryId,
    refreshByChatId: refreshArticles,
    queryStatus,
  } = useSupabaseRealtime(activeQueryId, chatId);
  // Sincroniza refreshArticlesRef após useSupabaseRealtime estar disponível
  useEffect(() => {
    refreshArticlesRef.current = refreshArticles;
  }, [refreshArticles]);
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

  // Reconstrói localExecutedIds após reload: se há artigos no banco para um queryId,
  // a busca foi definitivamente executada. Sem isso, os cards mostrariam "Iniciando..."
  // após refresh de página mesmo com buscas já concluídas.
  useEffect(() => {
    if (!articles?.length) return;
    setLocalExecutedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of articles) {
        if (a.queryId && !next.has(a.queryId)) {
          next.add(a.queryId);
          changed = true;
        }
      }
      return changed ? next : prev; // evita re-render desnecessário
    });
  }, [articles]);

  // P-ranking-sync: extrai a ordem do reranker semântico do output da tool de síntese.
  // Quando disponível, o acervo usa esses IDs para refletir a mesma ordem da revisão.
  // isSynthesisRunning: detecta se generate_systematic_review está em execução.
  // Necessário para manter a PipelineStatusBar visível durante o gap entre
  // queryStatus='done' (todos TL;DRs prontos) e o output da revisão final.
  const isSynthesisRunning = useMemo(() => {
    return messages.some((m) =>
      (m.parts ?? []).some(
        (p) =>
          isToolOrDynamicToolUIPart(p) &&
          getToolOrDynamicToolName(p) === 'generate_systematic_review' &&
          (p as any).state !== 'output-available'
      )
    );
  }, [messages]);

  const reviewRankedIds = useMemo<string[] | null>(() => {
    if (!activeQueryId) return null;

    // 1. Locate the exact message index where the active query was proposed.
    // This establishes a boundary so we don't pick up stale synthesis rankings
    // from prior queries in the chat history.
    let activeQueryIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      let found = false;
      for (const part of msg.parts ?? []) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        const name = getToolOrDynamicToolName(part);
        if (name === 'propose_search_sol_database' || name === 'propose_search_global_database') {
          const out = normalizeToolOutput((part as any).output);
          if (out?.success && out.query_id === activeQueryId) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        const msgObj = msg as unknown as { toolInvocations?: any[] };
        for (const inv of msgObj.toolInvocations ?? []) {
          if (
            inv.toolName === 'propose_search_sol_database' ||
            inv.toolName === 'propose_search_global_database'
          ) {
            if (inv.result?.success && inv.result?.query_id === activeQueryId) {
              found = true;
              break;
            }
          }
        }
      }
      if (found) {
        activeQueryIndex = i;
        break;
      }
    }

    if (activeQueryIndex === -1) return null;

    // 2. Scan only messages strictly AFTER the proposal for a synthesis generated for this query.
    for (let i = messages.length - 1; i > activeQueryIndex; i--) {
      const msg = messages[i];
      
      for (const part of msg.parts ?? []) {
        if (!isToolOrDynamicToolUIPart(part)) continue;
        if (getToolOrDynamicToolName(part) !== 'generate_systematic_review') continue;
        if (part.state !== 'output-available') continue;
        const out = normalizeToolOutput((part as any).output);
        const ids =
          out?.ranked_article_ids ||
          (part as any).result?.ranked_article_ids ||
          (part as any).toolInvocation?.result?.ranked_article_ids;
        if (Array.isArray(ids) && ids.length > 0) {
          return ids as string[];
        }
      }

      const msgObj = msg as unknown as {
        toolInvocations?: Array<{ toolName: string; result?: any; output?: any; args?: any }>;
      };
      for (const inv of msgObj.toolInvocations ?? []) {
        if (inv.toolName !== 'generate_systematic_review') continue;
        const ids =
          inv.result?.ranked_article_ids ||
          inv.output?.ranked_article_ids ||
          inv.args?.ranked_article_ids;
        if (Array.isArray(ids) && ids.length > 0) {
          return ids as string[];
        }
      }
    }
    return null;
  }, [messages, activeQueryId]);

  const displayArticles = useMemo(() => {
    // Queries que foram rejeitadas não devem exibir artigos no painel.
    // Isso evita mostrar artigos de uma busca que o RelevanceGate reprovou,
    // ou de uma busca cancelada — que confunde o usuário sobre o estado real.
    const HIDDEN_STATUSES = new Set(['needs_refinement', 'cancelled', 'failed']);
    const isQueryHidden =
      queryStatus !== null &&
      HIDDEN_STATUSES.has(queryStatus) &&
      (articles?.length
        ? articles.every((a) => (a as any).queryId === activeQueryId)
        : false);

    const rawArr = (() => {
      if (isQueryHidden) return [];
      
      const targetQueryId = activeQueryId ?? previousQueryIdRef.current;
      if (!targetQueryId) return [];
      
      const filtered = articles?.filter(a => (a as any).queryId === targetQueryId) ?? [];
      if (filtered.length) return filtered;
      
      if (isSearchRunning && previousArticlesRef.current.length) return previousArticlesRef.current;
      return [];
    })();

    if (!rawArr.length) return rawArr;

    // Após síntese: usa a ordem exata do reranker semântico (backend) — P-ranking-sync
    if (reviewRankedIds?.length) {
      const posMap = new Map(reviewRankedIds.map((id, i) => [id, i]));
      return [...rawArr].sort(
        (a, b) => (posMap.get(a.id) ?? Infinity) - (posMap.get(b.id) ?? Infinity)
      );
    }

    // Antes da síntese: ranking bibliométrico via lib/reranking.ts
    // Artigos em processamento (não-terminais) ficam ao final da lista.
    const TERMINAL = ['done', 'abstract_only'];
    const terminal = rawArr.filter((a) => TERMINAL.includes(a.status ?? ''));
    const processing = rawArr.filter((a) => !TERMINAL.includes(a.status ?? ''));
    return [...rankArticles(terminal as Article[]), ...processing];
  }, [articles, isSearchRunning, reviewRankedIds, queryStatus, activeQueryId]);

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
  // Ref do queryStatus para uso no P-14 timer (closure-safe, sem re-criar o timer)
  const queryStatusRef = useRef<string | null>(null);
  // Ref para detectar transições de status (impede triggers de chats antigos recarregados)
  const prevQueryStatusRef = useRef<string | null>(null);

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

  // Mantém a compatibilidade com a flag local (só por precaução)
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

  // Mantém queryStatusRef sincronizado para uso nos timers (evita closure stale)
  useEffect(() => {
    queryStatusRef.current = queryStatus;
  }, [queryStatus]);

  // Dispara síntese ou mensagem de refinamento baseado no status REAL da query no DB.
  // Utiliza a transição de status (prev !== null) para garantir que apenas observando o
  // ciclo de vida ativo na sessão atual disparamos as mensagens. Recarregar um chat antigo
  // inicializa com null -> 'done', que é rejeitado por prev !== null.
  useEffect(() => {
    const prevStatus = prevQueryStatusRef.current;
    prevQueryStatusRef.current = queryStatus;

    if (!activeQueryId || !queryStatus) return;
    
    // DEV LOG for debugging synthesis triggers
    console.log(`[DEBUG] queryStatus effect: activeQueryId=${activeQueryId}, queryStatus=${queryStatus}, prevStatus=${prevStatus}, reviewed=${reviewedQueryIdsRef.current.has(activeQueryId)}`);

    if (reviewedQueryIdsRef.current.has(activeQueryId)) return;

    if (queryStatus === 'done' && prevStatus !== 'done' && prevStatus !== null) {
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
              body: 'Seus artigos foram processados. A revisão bibliográfica está pronta!',
              icon: '/favicon.ico',
            });
          }
        } catch {
          /* Notification API indisponível */
        }
      }

      // Helper: dispara a mensagem [SISTEMA] de síntese dado o array de artigos disponíveis
      const dispatchSynthesisMessage = (arts: any[]) => {
        const isIncremental = arts.some((a: any) => a.queryId !== activeQueryId);
        if (isIncremental) {
          const cnt = arts.filter((a: any) => a.queryId === activeQueryId).length;
          sendMessageRef.current({
            text: `[SISTEMA] A busca adicional foi concluída: ${cnt} novo(s) artigo(s) processado(s). Chame generate_systematic_review com o parâmetro mode:"incremental" e gere uma análise CURTA (máx. 3 parágrafos) destacando o que os novos artigos confirmam, contradizem ou complementam em relação à síntese anterior. NÃO replique toda a revisão anterior — foque apenas nas novas contribuições.`,
          });
        } else {
          sendMessageRef.current({
            text: `[SISTEMA] Todos os artigos foram processados. Por favor, gere agora a revisão bibliográfica consolidada chamando a ferramenta generate_systematic_review.`,
          });
        }
      };

      const currentArts = articleCountRef.current ?? [];
      const hasContent = currentArts.some(
        (a: any) =>
          a.queryId === activeQueryId &&
          (a.status === 'done' || a.status === 'abstract_only') &&
          a.tldrContent
      );

      if (hasContent) {
        setTimeout(() => dispatchSynthesisMessage(currentArts), 500);
        return;
      }

      // Race condition: queryStatus=done chegou via Realtime ANTES dos eventos INSERT
      // de artigos (comum em buscas globais com cache hit, onde INSERT + UPDATE ocorrem
      // em ~134ms). Fallback: consulta direta ao Supabase após 2s.
      // `cancelled` garante que a IIFE async não chame sendMessage se o componente
      // desmontar antes dos 2s (cleanup do useEffect seta cancelled=true).
      let cancelled = false;
      void (async () => {
        await new Promise<void>((r) => setTimeout(r, 2_000));
        if (cancelled) return;
        const { data: dbArts } = await supabase
          .from('articles')
          .select('id, query_id, status, tldr_content')
          .eq('query_id', activeQueryId)
          .in('status', ['done', 'abstract_only']);
        if (cancelled || !dbArts?.some((a) => a.tldr_content)) return;
        // Combina artigos do DB com o ref atualizado (captura queries incrementais)
        const merged = [...(articleCountRef.current ?? []), ...dbArts];
        dispatchSynthesisMessage(merged);
      })();
      return () => {
        cancelled = true;
      };
    }

    if (queryStatus === 'needs_refinement' && prevStatus !== 'needs_refinement' && prevStatus !== null) {
      reviewedQueryIdsRef.current.add(activeQueryId);
      // Limpa indicador de busca em progresso
      setRunningSearches((prev) => {
        const n = new Set(prev);
        n.delete(activeQueryId);
        return n;
      });

      // Fase C (IA-04): mesma lógica de automação da falha via API.
      // Este caminho é acionado pelo Supabase Realtime após o RelevanceGate do Inngest.
      // Fase C (A-5): guard idempotente — mesma proteção do caminho API acima.
      if (!failureCountedRef.current.has(activeQueryId)) {
        failureCountedRef.current.add(activeQueryId);
        solSearchFailureCountRef.current += 1;
      }
      const failCount = solSearchFailureCountRef.current;
      setTimeout(() => {
        if (failCount === 1) {
          // 1ª falha (RelevanceGate rejeitou): AI relança SOL automaticamente
          sendMessageRef.current({
            text: `[SISTEMA] Os artigos encontrados não têm relevância suficiente para o tema (rejeitados pelo gate de qualidade). Chame IMEDIATAMENTE propose_search_sol_database com o MESMO tópico da conversa e queries:[]. O agente de estratégia já sabe quais queries foram usadas e vai diversificar os termos. NÃO escreva nada — chame a tool diretamente.`,
          });
        } else {
          // 2ª+ falha: AI escala para OpenAlex automaticamente
          sendMessageRef.current({
            text: `[SISTEMA] Após ${failCount} tentativas na base SOL sem resultados relevantes para o tema, chame IMEDIATAMENTE propose_search_global_database com o tópico da conversa em inglês/conceitos. NÃO escreva nada — chame a tool diretamente.`,
          });
        }
      }, 300);
    }
  }, [activeQueryId, queryStatus]);

  // Auto-sugestão de busca global quando zero resultados na SOL
  useEffect(() => {
    if (hasZeroResults && activeQueryId && !reviewedQueryIdsRef.current.has(activeQueryId)) {
      // Guard: não disparar se já existe uma proposta global — significa que o erro
      // veio de uma busca global (502/0), não de uma busca SOL sem resultados.
      const hasGlobalProposal = messages.some((m) =>
        m.parts
          ?.filter(isToolOrDynamicToolUIPart)
          .some((p) => getToolOrDynamicToolName(p) === 'propose_search_global_database')
      );
      if (hasGlobalProposal) return;

      reviewedQueryIdsRef.current.add(activeQueryId);
      const t = setTimeout(() => {
        sendMessageRef.current({
          text: `[SISTEMA] A busca no acervo SOL não retornou resultados para o tema solicitado. Chame IMEDIATAMENTE a tool propose_search_global_database. NÃO escreva nada — chame a tool diretamente.`,
        });
      }, 500);
      return () => clearTimeout(t);
    }
  }, [hasZeroResults, activeQueryId, messages]);

  // P-14: Safety net 60s com cleanup correto para evitar memory leak após navegação
  // Fase (P-14-fix): NÃO disparar se queryStatus ainda for 'processing' ou 'searching'
  // — indica que o Inngest ainda processa, artigos apenas não chegaram via Realtime.
  const zeroResultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeQueryId || isLoading || hasZeroResults) return;
    zeroResultsTimerRef.current = setTimeout(() => {
      const qStatus = queryStatusRef.current;
      const isStillProcessing = qStatus === 'processing' || qStatus === 'searching';
      if (
        !isStillProcessing &&
        articleCountRef.current.length === 0 &&
        !reviewedQueryIdsRef.current.has(activeQueryId)
      ) {
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
    // Fase C (IA-04): modo de síntese
    synthesisMode,
    setSynthesisMode,
    // Status da query ativa no DB (done/needs_refinement/processing/etc.) — usado
    // pelo PipelineStatusBar para feedback global step-by-step ao usuário.
    queryStatus,
    // true quando generate_systematic_review está em execução (para manter PipelineStatusBar)
    isSynthesisRunning,
  };
}

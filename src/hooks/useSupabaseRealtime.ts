'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { type articles } from '@/server/db/schema';
import { logger } from '@/lib/logger';

type Article = typeof articles.$inferSelect;

// H-01: Excluir markdown_content do SELECT para evitar payloads de ate 30k chars
// via WebSocket. O campo nao eh usado na UI - pode ser buscado sob demanda se necessario.
// P-09: Excluir abstract_embedding (~6KB por artigo) do canal WebSocket - nunca usado na UI.
const ARTICLE_COLUMNS = [
  'id',
  'query_id',
  'doi',
  'title',
  'authors',
  'source_name',
  'publication_year',
  'original_url',
  'status',
  'tldr_content',
  'abstract',
  'keywords',
  'citation_count',
  'publisher',
  'is_open_access',
  'metadata_source',
  'citation_graph',
  'created_at',
  'updated_at',
].join(',');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapArticle = (raw: any): Article => ({
  id: raw.id as string,
  queryId: raw.query_id as string,
  doi: (raw.doi as string | null) ?? null,
  title: (raw.title as string) ?? '',
  authors: (raw.authors as string | null) ?? null,
  sourceName: (raw.source_name as string | null) ?? null,
  publicationYear: (raw.publication_year as number | null) ?? null,
  originalUrl: (raw.original_url as string) ?? '',
  status: (raw.status as string) ?? 'pending',
  // H-01: markdownContent nunca armazenado no estado cliente - buscar sob demanda
  markdownContent: null,
  tldrContent: (raw.tldr_content as string | null) ?? null,
  abstract: (raw.abstract as string | null) ?? null,
  keywords: (raw.keywords as string | null) ?? null,
  citationCount: (raw.citation_count as number | null) ?? null,
  publisher: (raw.publisher as string | null) ?? null,
  isOpenAccess: (raw.is_open_access as boolean | null) ?? null,
  metadataSource: (raw.metadata_source as string | null) ?? null,
  // P-09: abstract_embedding excluido do SELECT - nunca enviado via WebSocket
  abstractEmbedding: null,
  // Fase 6 (P-seguinte): grafo de citações (JSONB — enviado como objeto pelo Supabase)
  citationGraph: (raw.citation_graph as Article['citationGraph']) ?? null,
  createdAt: raw.created_at ? new Date(raw.created_at as string) : new Date(),
  updatedAt: raw.updated_at ? new Date(raw.updated_at as string) : new Date(),
});

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Fase 1 (P-01): Hook atualizado para aceitar chatId como ancora primaria.
 * - Usa chatId para busca inicial (todos os artigos do chat, via search_queries.chat_id)
 * - Usa activeQueryId para subscricao Realtime (artigos da busca corrente)
 * - Quando activeQueryId muda (nova busca), mantem artigos anteriores e adiciona novos
 * Fase 3 (P-PDF): addQueryId() permite subscrever a queryIds de uploads fora do fluxo chat
 */
export function useSupabaseRealtime(activeQueryId: string | null, chatId?: string | null) {
  const [data, setData] = useState<Article[]>([]);
  // E-04: estado de conexao exposto para a UI exibir badge de aviso
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // P-03 FIX: contador de reconexão — ao incrementar, o useEffect re-cria o canal WebSocket
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  // Fase 3 (P-PDF): queryIds extras de uploads (fora do fluxo do chat)
  const [extraQueryIds, setExtraQueryIds] = useState<Set<string>>(new Set());

  // Status da query ativa — subscrito via Realtime para disparar síntese/refinamento
  // somente quando o Inngest confirmar que TODOS os batches foram concluídos.
  //
  // IMPORTANTE: armazenamos { id, status } em vez de apenas string para evitar
  // race condition entre buscas na mesma sessão:
  //   Render N:   activeQueryId='A', queryStatus='done' (busca 1 concluída)
  //   Render N+1: activeQueryId='B' (nova busca), queryStatus ainda é 'done' (stale)
  //   → effect de síntese dispararia prematuramente para 'B' com status stale de 'A'
  // Ao derivar queryStatus=null quando id≠activeQueryId no return, eliminamos o
  // problema SEM depender de timing de efeitos ou re-renders extras.
  const [queryStatusEntry, setQueryStatusEntry] = useState<{ id: string; status: string } | null>(
    null
  );

  // Handler reutilizável entre a subscrição principal e as extras
  const handlePayload = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload: any) => {
      if (payload.eventType === 'INSERT') {
        setData((prev) => {
          if (prev.some((a) => a.id === payload.new.id)) return prev;
          return [mapArticle(payload.new), ...prev];
        });
      }
      if (payload.eventType === 'UPDATE') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = payload.new as any;
        setData((prev) =>
          prev.map((item) => {
            if (item.id !== raw.id) return item;
            const mappedRaw = mapArticle(raw);
            return {
              ...item,
              doi: mappedRaw.doi ?? item.doi,
              title: mappedRaw.title ?? item.title,
              authors: mappedRaw.authors ?? item.authors,
              sourceName: mappedRaw.sourceName ?? item.sourceName,
              publicationYear: mappedRaw.publicationYear ?? item.publicationYear,
              originalUrl: mappedRaw.originalUrl ?? item.originalUrl,
              status: mappedRaw.status ?? item.status,
              tldrContent: mappedRaw.tldrContent ?? item.tldrContent,
              abstract: mappedRaw.abstract ?? item.abstract,
              keywords: mappedRaw.keywords ?? item.keywords,
              citationCount: mappedRaw.citationCount ?? item.citationCount,
              publisher: mappedRaw.publisher ?? item.publisher,
              isOpenAccess: mappedRaw.isOpenAccess ?? item.isOpenAccess,
              metadataSource: mappedRaw.metadataSource ?? item.metadataSource,
              updatedAt: mappedRaw.updatedAt,
            };
          })
        );
      }
      if (payload.eventType === 'DELETE') {
        setData((prev) => prev.filter((item) => item.id !== payload.old.id));
      }
    },
    []
  );

  /** Fase 3 (P-PDF): adiciona uma queryId de upload à lista de subscriptions ativas */
  const addQueryId = useCallback((id: string) => {
    setExtraQueryIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Fase 1: busca inicial por chatId (todos os artigos do chat)
  const fetchByChatId = useCallback(async (cid: string) => {
    logger.log(`[useSupabaseRealtime] fetchByChatId: ${cid}`);
    const { data: rows, error } = await supabase
      .from('articles')
      .select(`${ARTICLE_COLUMNS}, search_queries!inner(chat_id)`)
      .eq('search_queries.chat_id', cid)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[useSupabaseRealtime] fetchByChatId error:', error);
      return;
    }
    if (rows && rows.length > 0) {
      logger.log(`[useSupabaseRealtime] fetchByChatId: ${rows.length} artigos`);
      setData(rows.map(mapArticle));
    }
  }, []);

  /** Recarrega todos os artigos do chat — útil após upload para mostrar o novo artigo */
  const refreshByChatId = useCallback(async () => {
    if (!chatId) return;
    await fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  const fetchInitial = useCallback(async (id: string) => {
    logger.log(`[useSupabaseRealtime] fetchInitial starting for ${id}`);
    const { data: initialData, error } = await supabase
      .from('articles')
      .select(ARTICLE_COLUMNS)
      .eq('query_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[useSupabaseRealtime] fetch error:', error);
      return;
    }
    if (initialData) {
      logger.log(`[useSupabaseRealtime] fetchInitial got ${initialData.length} rows`);
      // Fase 1: mescla com artigos existentes de queries anteriores do mesmo chat
      setData((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newArticles = initialData.map(mapArticle).filter((a) => !existingIds.has(a.id));
        return [...prev, ...newArticles];
      });
    }
  }, []);

  // Fase 1: busca inicial por chatId ao montar (recupera historico de buscas anteriores)
  useEffect(() => {
    if (!chatId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  useEffect(() => {
    logger.log(`[useSupabaseRealtime] Hook mounted/queryId changed: ${activeQueryId}`);
    if (!activeQueryId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtimeStatus('connecting');
    fetchInitial(activeQueryId);

    // Set up Realtime Subscription
    const channel = supabase
      .channel(`articles_filter_${activeQueryId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'articles',
          filter: `query_id=eq.${activeQueryId}`,
        },
        handlePayload
      )
      .subscribe((status) => {
        // E-04: monitorar estado da conexao WebSocket
        if (status === 'SUBSCRIBED') {
          logger.log('[useSupabaseRealtime] Canal conectado');
          setRealtimeStatus('connected');
          // Cancela reconexao pendente se havia uma
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.warn(`[useSupabaseRealtime] Canal em estado: ${status} - agendando reconexao`);
          setRealtimeStatus('disconnected');
          // Refetch manual imediato + re-subscribe após 5s
          // O refetch garante dados atualizados mesmo sem WebSocket
          fetchInitial(activeQueryId);
          reconnectTimerRef.current = setTimeout(() => {
            logger.log('[useSupabaseRealtime] Re-subscribe apos desconexao');
            // Incrementa trigger → useEffect cleanup + nova subscrição
            setReconnectTrigger((n) => n + 1);
          }, 5_000);
        } else if (status === 'CLOSED') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
    // reconnectTrigger força re-criação do canal após TIMED_OUT/CHANNEL_ERROR
  }, [activeQueryId, fetchInitial, reconnectTrigger, handlePayload]);

  // Fase 3 (P-PDF): subscriptions extras para queryIds de uploads
  useEffect(() => {
    if (extraQueryIds.size === 0) return;
    const channels = Array.from(extraQueryIds).map((qId) => {
      fetchInitial(qId); // busca inicial para o queryId do upload
      return supabase
        .channel(`articles_upload_${qId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'articles', filter: `query_id=eq.${qId}` },
          handlePayload
        )
        .subscribe();
    });
    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [extraQueryIds, fetchInitial, handlePayload]);

  // Subscrição ao status da query ativa — dispara síntese só quando
  // Inngest marca searchQueries.status = 'done' (todos os batches concluídos).
  useEffect(() => {
    if (!activeQueryId) {
      setQueryStatusEntry(null);
      return;
    }

    // Fetch inicial do status da query
    supabase
      .from('search_queries')
      .select('status')
      .eq('id', activeQueryId)
      .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data: q }: { data: any }) => {
        if (q?.status) setQueryStatusEntry({ id: activeQueryId, status: q.status as string });
      });

    const channel = supabase
      .channel(`query_status_${activeQueryId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'search_queries',
          filter: `id=eq.${activeQueryId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const newStatus = payload.new?.status as string | undefined;
          if (newStatus) {
            logger.log(`[useSupabaseRealtime] Query status → ${newStatus}`);
            setQueryStatusEntry({ id: activeQueryId, status: newStatus });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeQueryId]);

  // Polling fallback para search_queries.status — necessário quando a tabela não tem
  // Realtime habilitado no Supabase Dashboard. Consulta a cada 3s enquanto o status
  // não atingiu um estado terminal. O Realtime (acima) continua ativo e, se funcionar,
  // atualiza o estado mais rápido — o polling só age se o Realtime silenciar.
  const TERMINAL_STATUSES = new Set(['done', 'needs_refinement', 'failed', 'cancelled']);
  // Deriva o status efetivo para este activeQueryId (null se entry.id !== activeQueryId)
  const effectiveQueryStatus =
    queryStatusEntry?.id === activeQueryId ? queryStatusEntry.status : null;
  useEffect(() => {
    if (!activeQueryId) return;
    if (effectiveQueryStatus && TERMINAL_STATUSES.has(effectiveQueryStatus)) return; // já terminal

    let consecutiveNulls = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      // maybeSingle() retorna null (sem erro) se 0 linhas — evita 406 do PostgREST
      const { data: q, error } = await supabase
        .from('search_queries')
        .select('status')
        .eq('id', activeQueryId)
        .maybeSingle();

      if (error) {
        logger.warn(`[useSupabaseRealtime] Poll erro: ${error.message}`);
        return;
      }

      if (q === null) {
        // ID não encontrado na tabela (ex: activeQueryId resolveu para chat_id após reload)
        consecutiveNulls++;
        if (consecutiveNulls >= 2) {
          logger.warn(
            `[useSupabaseRealtime] Poll: ID ${activeQueryId} não encontrado em search_queries — parando polling`
          );
          if (intervalId) clearInterval(intervalId);
        }
        return;
      }

      consecutiveNulls = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newStatus = (q as any)?.status as string | undefined;
      if (newStatus && newStatus !== effectiveQueryStatus) {
        logger.log(`[useSupabaseRealtime] Poll: query status → ${newStatus}`);
        setQueryStatusEntry({ id: activeQueryId, status: newStatus });
      }
    };

    intervalId = setInterval(() => void poll(), 3_000);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueryId, effectiveQueryStatus]);

  // effectiveQueryStatus é null quando queryStatusEntry.id ≠ activeQueryId —
  // isso garante que buscas anteriores não contaminem o estado da busca atual.
  return { data, realtimeStatus, addQueryId, refreshByChatId, queryStatus: effectiveQueryStatus };
}

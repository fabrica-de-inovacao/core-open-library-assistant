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
  createdAt: raw.created_at ? new Date(raw.created_at as string) : new Date(),
  updatedAt: raw.updated_at ? new Date(raw.updated_at as string) : new Date(),
});

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Fase 1 (P-01): Hook atualizado para aceitar chatId como ancora primaria.
 * - Usa chatId para busca inicial (todos os artigos do chat, via search_queries.chat_id)
 * - Usa activeQueryId para subscricao Realtime (artigos da busca corrente)
 * - Quando activeQueryId muda (nova busca), mantem artigos anteriores e adiciona novos
 */
export function useSupabaseRealtime(
  activeQueryId: string | null,
  chatId?: string | null
) {
  const [data, setData] = useState<Article[]>([]);
  // E-04: estado de conexao exposto para a UI exibir badge de aviso
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  useEffect(() => {
    logger.log(`[useSupabaseRealtime] Hook mounted/queryId changed: ${activeQueryId}`);
    if (!activeQueryId) return;

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
        (payload) => {
          logger.log('Realtime Update:', payload);
          // Handle Insert
          if (payload.eventType === 'INSERT') {
            setData((prev) => {
              // Fase 1: evita duplicatas se fetchByChatId ja inseriu o artigo
              if (prev.some((a) => a.id === payload.new.id)) return prev;
              return [mapArticle(payload.new), ...prev];
            });
          }
          // Handle Update
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
                  // H-01: markdownContent nunca sincronizado via WebSocket
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
          // Handle Delete
          if (payload.eventType === 'DELETE') {
            setData((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
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
          // Refetch manual como fallback apos 5s para nao perder atualizacoes
          reconnectTimerRef.current = setTimeout(() => {
            logger.log('[useSupabaseRealtime] Refetch manual apos desconexao');
            fetchInitial(activeQueryId);
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
  }, [activeQueryId, fetchInitial]);

  return { data, realtimeStatus };
}

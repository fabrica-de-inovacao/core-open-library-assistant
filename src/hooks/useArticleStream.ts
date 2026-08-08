'use client';

import { useCallback, useEffect, useState } from 'react';
import { type articles } from '@/server/db/schema';
import { logger } from '@/lib/logger';

type Article = typeof articles.$inferSelect;
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

type StreamMessage =
  | { type: 'article.updated'; article_id: string; status: string; tldr_content?: string | null }
  | { type: 'query.status'; query_id: string; status: string };

export function useArticleStream(activeQueryId: string | null, chatId?: string | null) {
  const [data, setData] = useState<Article[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [extraQueryIds, setExtraQueryIds] = useState<Set<string>>(new Set());
  const [queryStatusEntry, setQueryStatusEntry] = useState<{ id: string; status: string } | null>(
    null
  );

  const fetchByChatId = useCallback(async (cid: string) => {
    const res = await fetch(`/api/articles?chatId=${encodeURIComponent(cid)}`);
    if (!res.ok) return;
    const rows = (await res.json()) as Article[];
    setData(rows);
  }, []);

  const refreshByChatId = useCallback(async () => {
    if (!chatId) return;
    await fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  const fetchInitial = useCallback(async (id: string) => {
    const res = await fetch(`/api/articles?queryId=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const rows = (await res.json()) as Article[];
    setData((prev) => {
      const existingIds = new Set(prev.map((a) => a.id));
      const newArticles = rows.filter((a) => !existingIds.has(a.id));
      return [...prev, ...newArticles];
    });
  }, []);

  const fetchStatus = useCallback(async (id: string) => {
    const res = await fetch(`/api/queries/${encodeURIComponent(id)}/status`);
    if (!res.ok) return;
    const q = (await res.json()) as { status?: string };
    if (q.status) setQueryStatusEntry({ id, status: q.status });
  }, []);

  useEffect(() => {
    if (!chatId) return;
    void fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  useEffect(() => {
    if (!activeQueryId) return;
    setRealtimeStatus('connecting');
    void fetchInitial(activeQueryId);
    void fetchStatus(activeQueryId);

    const source = new EventSource(`/api/stream/${activeQueryId}`);
    source.onopen = () => setRealtimeStatus('connected');
    source.onerror = () => setRealtimeStatus('disconnected');
    source.onmessage = (event) => {
      const msg = JSON.parse(event.data) as StreamMessage;
      if (msg.type === 'article.updated') {
        setData((prev) => {
          if (!prev.some((a) => a.id === msg.article_id)) {
            void fetchInitial(activeQueryId);
            return prev;
          }
          return prev.map((a) =>
            a.id === msg.article_id
              ? { ...a, status: msg.status, tldrContent: msg.tldr_content ?? a.tldrContent }
              : a
          );
        });
      }
      if (msg.type === 'query.status') {
        setQueryStatusEntry({ id: activeQueryId, status: msg.status });
      }
    };

    return () => source.close();
  }, [activeQueryId, fetchInitial, fetchStatus]);

  useEffect(() => {
    if (extraQueryIds.size === 0) return;
    Array.from(extraQueryIds).forEach((id) => void fetchInitial(id));
  }, [extraQueryIds, fetchInitial]);

  const addQueryId = useCallback((id: string) => {
    setExtraQueryIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const effectiveQueryStatus =
    queryStatusEntry?.id === activeQueryId ? queryStatusEntry.status : null;

  useEffect(() => {
    const terminal = new Set(['done', 'needs_refinement', 'failed', 'cancelled']);
    if (!activeQueryId) return;
    if (effectiveQueryStatus && terminal.has(effectiveQueryStatus)) return;

    const intervalId = setInterval(() => {
      void fetchStatus(activeQueryId);
      void fetchInitial(activeQueryId);
    }, 3_000);
    return () => clearInterval(intervalId);
  }, [activeQueryId, effectiveQueryStatus, fetchInitial, fetchStatus]);

  return { data, realtimeStatus, addQueryId, refreshByChatId, queryStatus: effectiveQueryStatus };
}

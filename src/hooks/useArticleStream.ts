'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type articles } from '@/server/db/schema';

type Article = typeof articles.$inferSelect;
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';
export type SearchRunSummary = {
  id: string;
  searchGroupId: string;
  attempt: number;
  source: string;
  status: string;
  originalQuery: string;
  expectedCount: number;
  completedCount: number;
  failedCount: number;
  revision: number;
  createdAt: string | Date;
};

type RunSnapshot = {
  run: { id: string; status: string; revision: number };
  attempts: SearchRunSummary[];
  articles: Article[];
};

export function useArticleStream(activeQueryId: string | null, chatId?: string | null) {
  const [data, setData] = useState<Article[]>([]);
  const [runs, setRuns] = useState<SearchRunSummary[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [extraQueryIds, setExtraQueryIds] = useState<Set<string>>(new Set());
  const [queryStatusEntry, setQueryStatusEntry] = useState<{ id: string; status: string } | null>(
    null
  );
  const revisionRef = useRef<{ id: string; revision: number } | null>(null);

  const fetchByChatId = useCallback(async (cid: string) => {
    const [articlesRes, runsRes] = await Promise.all([
      fetch(`/api/articles?chatId=${encodeURIComponent(cid)}`),
      fetch(`/api/search-runs?chatId=${encodeURIComponent(cid)}`),
    ]);
    if (articlesRes.ok) setData((await articlesRes.json()) as Article[]);
    if (runsRes.ok) setRuns((await runsRes.json()) as SearchRunSummary[]);
  }, []);

  const refreshByChatId = useCallback(async () => {
    if (!chatId) return;
    await fetchByChatId(chatId);
  }, [chatId, fetchByChatId]);

  const fetchInitial = useCallback(async (id: string) => {
    const res = await fetch(`/api/search-runs/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const snapshot = (await res.json()) as RunSnapshot;
    setData((prev) => [...prev.filter((a) => a.queryId !== id), ...snapshot.articles]);
    setRuns((prev) => {
      const ids = new Set(snapshot.attempts.map((run) => run.id));
      return [...prev.filter((run) => !ids.has(run.id)), ...snapshot.attempts];
    });
    setQueryStatusEntry({ id, status: snapshot.run.status });
    revisionRef.current = { id, revision: snapshot.run.revision };
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
    void fetchInitial(activeQueryId);
    void fetchStatus(activeQueryId);

    const source = new EventSource(`/api/stream/${activeQueryId}`);
    source.onopen = () => setRealtimeStatus('connected');
    source.onerror = () => setRealtimeStatus('disconnected');
    source.addEventListener('run.updated', (event) => {
      const update = JSON.parse(event.data) as { revision: number };
      if (revisionRef.current?.id !== activeQueryId || update.revision > revisionRef.current.revision) {
        void fetchInitial(activeQueryId);
      }
    });

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

  const activeRun = runs.find((run) => run.id === activeQueryId) ?? null;

  return {
    data,
    runs,
    activeRun,
    realtimeStatus,
    addQueryId,
    refreshByChatId,
    queryStatus: effectiveQueryStatus,
  };
}

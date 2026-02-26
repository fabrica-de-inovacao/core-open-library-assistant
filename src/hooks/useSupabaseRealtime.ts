'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type articles } from '@/server/db/schema';

type Article = typeof articles.$inferSelect;

export function useSupabaseRealtime(queryId: string | null) {
  const [data, setData] = useState<Article[]>([]);

  useEffect(() => {
    if (!queryId) return;

    // Fetch initial data
    const fetchInitial = async () => {
      const { data: initialData, error } = await supabase
        .from('articles')
        .select('*')
        .eq('query_id', queryId)
        .order('created_at', { ascending: false });

      if (initialData && !error) {
        setData(initialData as Article[]);
      }
    };

    fetchInitial();

    // Set up Realtime Subscription
    const channel = supabase
      .channel(`articles_filter_${queryId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'articles',
          filter: `query_id=eq.${queryId}`,
        },
        (payload) => {
          console.log('Realtime Update:', payload);
          // Handle Insert
          if (payload.eventType === 'INSERT') {
            setData((prev) => [payload.new as Article, ...prev]);
          }
          // Handle Update — payload.new uses snake_case (DB columns) but our Article type uses camelCase (Drizzle).
          // We must map explicitly, otherwise fields like tldrContent never update from Realtime events.
          if (payload.eventType === 'UPDATE') {
            const raw = payload.new as Record<string, unknown>;
            setData((prev) =>
              prev.map((item) => {
                if (item.id !== raw.id) return item;
                return {
                  ...item,
                  // Map all snake_case DB columns to camelCase
                  doi: (raw.doi as string | null) ?? item.doi,
                  title: (raw.title as string) ?? item.title,
                  authors: (raw.authors as string | null) ?? item.authors,
                  sourceName: (raw.source_name as string | null) ?? item.sourceName,
                  publicationYear: (raw.publication_year as number | null) ?? item.publicationYear,
                  originalUrl: (raw.original_url as string) ?? item.originalUrl,
                  status: (raw.status as string | null) ?? item.status,
                  markdownContent: (raw.markdown_content as string | null) ?? item.markdownContent,
                  tldrContent: (raw.tldr_content as string | null) ?? item.tldrContent,
                  updatedAt: raw.updated_at ? new Date(raw.updated_at as string) : item.updatedAt,
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryId]);

  return data;
}

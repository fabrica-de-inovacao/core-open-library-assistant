'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type articles } from '@/server/db/schema';

type Article = typeof articles.$inferSelect;

const mapArticle = (raw: any): Article => ({
  id: raw.id,
  queryId: raw.query_id,
  doi: raw.doi,
  title: raw.title,
  authors: raw.authors,
  sourceName: raw.source_name,
  publicationYear: raw.publication_year,
  originalUrl: raw.original_url,
  status: raw.status,
  markdownContent: raw.markdown_content,
  tldrContent: raw.tldr_content,
  abstract: raw.abstract,
  keywords: raw.keywords,
  citationCount: raw.citation_count,
  publisher: raw.publisher,
  isOpenAccess: raw.is_open_access,
  metadataSource: raw.metadata_source,
  createdAt: raw.created_at ? new Date(raw.created_at) : new Date(),
  updatedAt: raw.updated_at ? new Date(raw.updated_at) : new Date(),
});

export function useSupabaseRealtime(queryId: string | null) {
  const [data, setData] = useState<Article[]>([]);

  useEffect(() => {
    console.log(`[useSupabaseRealtime] Hook mounted/queryId changed: ${queryId}`);
    if (!queryId) return;

    // Fetch initial data
    const fetchInitial = async () => {
      console.log(`[useSupabaseRealtime] fetchInitial starting for ${queryId}`);
      const { data: initialData, error } = await supabase
        .from('articles')
        .select('*')
        .eq('query_id', queryId)
        .order('created_at', { ascending: false });

      if (error) console.error('[useSupabaseRealtime] fetch error:', error);
      if (initialData && !error) {
        console.log(`[useSupabaseRealtime] fetchInitial got ${initialData.length} rows`);
        setData(initialData.map(mapArticle));
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
            setData((prev) => [mapArticle(payload.new), ...prev]);
          }
          // Handle Update
          if (payload.eventType === 'UPDATE') {
            const raw = payload.new as any;
            setData((prev) =>
              prev.map((item) => {
                if (item.id !== raw.id) return item;
                // Postgres Realtime `UPDATE` payloads contain the FULL row,
                // so we can safely map it and fallback to `item` for missing fields
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
                  markdownContent: mappedRaw.markdownContent ?? item.markdownContent,
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryId]);

  return data;
}

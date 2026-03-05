'use client';

/**
 * components/workspace/QueryHistoryBar.tsx
 * P-23: Barra horizontal mostrando o histórico de queries da sessão atual.
 * Exibe chips clicáveis com status de cada query — ficam visíveis no topo do painel de chat.
 * Setas de scroll (← →) aparecem apenas ao passar o mouse e somem quando não há mais conteúdo.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle2, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface QueryGroup {
  queryId: string;
  topic: string;
  totalCount: number;
  doneCount: number;
  isRunning: boolean;
}

interface QueryHistoryBarProps {
  groups: QueryGroup[];
  activeQueryId: string | null;
  /** Callback ao clicar num chip — passa o queryId selecionado */
  onSelectQuery: (queryId: string) => void;
}

const SCROLL_STEP = 200;

export function QueryHistoryBar({ groups, activeQueryId, onSelectQuery }: QueryHistoryBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [groups, updateScrollState]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: dir === 'left' ? -SCROLL_STEP : SCROLL_STEP,
      behavior: 'smooth',
    });
  };

  if (groups.length === 0) return null;

  return (
    <div className="group/bar bg-muted/20 relative flex h-10 shrink-0 items-center">
      {/* Seta esquerda */}
      <button
        onClick={() => scroll('left')}
        aria-label="Scroll esquerda"
        className={cn(
          'absolute left-0 z-10 flex h-full items-center px-1 transition-opacity duration-200',
          'from-muted/60 bg-gradient-to-r to-transparent',
          canScrollLeft ? 'opacity-0 group-hover/bar:opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <ChevronLeft className="text-muted-foreground size-4" />
      </button>

      {/* Fade esquerdo */}
      <div
        className={cn(
          'from-muted/40 pointer-events-none absolute left-0 z-[5] h-full w-8 bg-gradient-to-r to-transparent transition-opacity duration-200',
          canScrollLeft ? 'opacity-0 group-hover/bar:opacity-100' : 'opacity-0'
        )}
      />

      {/* Área de scroll */}
      <div
        ref={scrollRef}
        className="scrollbar-none flex h-full flex-1 items-center gap-1.5 overflow-x-auto px-4"
        style={{ scrollBehavior: 'smooth' }}
      >
        {/* Ícone label fixo */}
        <div className="text-muted-foreground flex shrink-0 items-center gap-1 pr-1">
          <History className="size-3" />
          <span className="text-[10px] font-medium tracking-wider uppercase">Queries</span>
        </div>

        {groups.map((g, idx) => {
          const isActive = g.queryId === activeQueryId;
          const isAllDone = g.totalCount > 0 && g.doneCount >= g.totalCount;
          const shortTopic = g.topic.length > 35 ? g.topic.slice(0, 32) + '…' : g.topic;

          return (
            <button
              key={g.queryId}
              onClick={() => onSelectQuery(g.queryId)}
              title={g.topic}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all hover:shadow-sm focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                isActive
                  ? 'border-primary/40 bg-primary/10 text-primary focus-visible:ring-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground focus-visible:ring-primary/50'
              )}
            >
              {/* Número da query */}
              <span
                className={cn(
                  'rounded-full px-1 py-0 text-[10px] leading-none font-bold',
                  isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                Q{idx + 1}
              </span>

              {/* Tópico */}
              <span className="max-w-[180px] truncate">{shortTopic}</span>

              {/* Status */}
              {g.isRunning ? (
                <Loader2 className="text-primary size-3 shrink-0 animate-spin" />
              ) : isAllDone ? (
                <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
              ) : g.totalCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-4 px-1 py-0 text-[10px] leading-none font-semibold"
                >
                  {g.doneCount}/{g.totalCount}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Fade direito */}
      <div
        className={cn(
          'from-muted/40 pointer-events-none absolute right-0 z-[5] h-full w-8 bg-gradient-to-l to-transparent transition-opacity duration-200',
          canScrollRight ? 'opacity-0 group-hover/bar:opacity-100' : 'opacity-0'
        )}
      />

      {/* Seta direita */}
      <button
        onClick={() => scroll('right')}
        aria-label="Scroll direita"
        className={cn(
          'absolute right-0 z-10 flex h-full items-center px-1 transition-opacity duration-200',
          'from-muted/60 bg-gradient-to-l to-transparent',
          canScrollRight ? 'opacity-0 group-hover/bar:opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <ChevronRight className="text-muted-foreground size-4" />
      </button>
    </div>
  );
}

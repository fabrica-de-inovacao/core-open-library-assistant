'use client';

/**
 * components/workspace/home/TrendingTopics.tsx
 *
 * Secção "Tópicos em alta" da HomeView — marquee horizontal de 3 faixas.
 * Cada faixa anima em direções/velocidades diferentes.
 */

import { Flame, TrendingUp, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TrendingTopic } from '@/app/api/trending-topics/route';

interface TrendingTopicsProps {
  topics: TrendingTopic[];
  isLoading: boolean;
  onSelect: (label: string) => void;
}

// Larguras fixas para o skeleton — evitam layout shift
const SKELETON_WIDTHS = [
  [140, 120, 165, 130, 115, 150, 125, 140],
  [125, 155, 110, 145, 135, 120, 160, 130],
  [135, 115, 150, 125, 145, 110, 155, 135],
];

const TRACK_CLASSES = ['marquee-track', 'marquee-track-reverse', 'marquee-track-slow'] as const;

export function TrendingTopics({ topics, isLoading, onSelect }: TrendingTopicsProps) {
  return (
    <div className="mt-8">
      {/* Label + tooltip */}
      <div className="mb-3 flex items-center gap-1.5">
        <Flame className="text-sol-amber h-3.5 w-3.5" />
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
          Tópicos em alta na computação
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground/30 hover:text-muted-foreground flex items-center transition-colors"
            >
              <Info className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-center text-xs">
            Sugestões baseadas nos tópicos em alta de Ciência da Computação no OpenAlex e nas
            pesquisas mais recorrentes dos usuários da SOL.
          </TooltipContent>
        </Tooltip>
      </div>

      {/* 3 faixas com máscara de fade lateral */}
      <div
        className="marquee-container relative flex flex-col gap-2 overflow-hidden"
        style={{
          height: '127px' /* 3 × 37px + 2 × 8px — sem layout shift */,
          maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        }}
      >
        {isLoading
          ? /* Skeleton — 3 linhas de pills */
            SKELETON_WIDTHS.map((widths, ri) => (
              <div key={ri} className="flex gap-2.5 overflow-hidden py-0.5">
                {widths.map((w, i) => (
                  <div
                    key={i}
                    className="bg-muted h-[33px] shrink-0 animate-pulse rounded-full"
                    style={{ width: `${w}px` }}
                  />
                ))}
              </div>
            ))
          : TRACK_CLASSES.map((cls, ri) => {
              const slices = [topics.slice(0, 4), topics.slice(4, 7), topics.slice(7)];
              const row = slices[ri] ?? slices[0];
              return (
                <div key={ri} className={`${cls} flex w-max gap-2.5 py-0.5`}>
                  {[...row, ...row].map((topic, idx) => (
                    <button
                      key={`${topic.id}-${ri}-${idx}`}
                      type="button"
                      onClick={() => onSelect(topic.label)}
                      className="group border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-primary flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 transition-all focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <TrendingUp className="text-muted-foreground/30 group-hover:text-primary h-3 w-3 shrink-0 transition-colors" />
                      <span className="text-foreground/60 group-hover:text-foreground text-[12.5px] font-medium whitespace-nowrap transition-colors">
                        {topic.label}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
      </div>
    </div>
  );
}

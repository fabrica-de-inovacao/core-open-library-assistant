'use client';

/**
 * SimilarQueryBanner — 1.2.3 Memória Semântica entre Sessões
 * Exibido acima do SearchProposalCard quando o sistema detecta que
 * o usuário já realizou uma busca semanticamente similar (similarity >= 85%).
 */

import { History } from 'lucide-react';

export interface SimilarQueryInfo {
  topic: string;
  date: string;
  similarity: number;
}

interface SimilarQueryBannerProps {
  info: SimilarQueryInfo;
}

export function SimilarQueryBanner({ info }: SimilarQueryBannerProps) {
  return (
    <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3.5 py-2.5 dark:border-amber-800/40 dark:bg-amber-950/20">
      <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="text-[11px] leading-snug font-semibold text-amber-800 dark:text-amber-300">
          📌 Você pesquisou algo similar em {info.date}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-amber-700/80 dark:text-amber-400/70">
          &ldquo;{info.topic.slice(0, 80)}
          {info.topic.length > 80 ? '…' : ''}&rdquo;
          <span className="ml-1.5 text-amber-600/60 dark:text-amber-500/50">
            ({info.similarity}% similar)
          </span>
        </p>
      </div>
    </div>
  );
}

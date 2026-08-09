'use client';

import { useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

interface UsageStatsProps {
  chatId?: string;
}

interface UsageData {
  usage: {
    events: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
    costMicrousd: number;
    chatTurns: number;
  };
  acervo: {
    done: number;
    abstract: number;
    failed: number;
    total: number;
  };
  searches: number;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtUSD(microUSD: number): string {
  if (microUSD === 0) return '$0.00';
  const usd = microUSD / 1_000_000;
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function StatLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-foreground text-[12px] font-medium tabular-nums">{value}</span>
        {hint && <span className="text-muted-foreground text-[10px]">({hint})</span>}
      </div>
    </div>
  );
}

function ShimmerLine() {
  return (
    <div className="flex items-center justify-between py-1">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export function UsageStatsPopover({ chatId }: UsageStatsProps) {
  const [stats, setStats] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');

  const fetchStats = async (p: 'today' | 'week' | 'month') => {
    setLoading(true);
    try {
      const url = chatId
        ? `/api/usage/stats?scope=chat&chatId=${chatId}`
        : `/api/usage/stats?scope=user&period=${p}`;
      const res = await fetch(url);
      if (res.ok) setStats(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (p: 'today' | 'week' | 'month') => {
    setPeriod(p);
    void fetchStats(p);
  };

  return (
    <Popover onOpenChange={(open) => { if (open) void fetchStats(period); }}>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md p-1.5 transition-colors">
          <BarChart3 className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" sideOffset={4}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-foreground text-[12px] font-semibold">
            {chatId ? 'Estatísticas do chat' : 'Estatísticas'}
          </p>
          {!chatId && (
            <div className="bg-muted/60 flex gap-0.5 rounded-md p-0.5">
              {(['today', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    period === p
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p === 'today' ? 'Hoje' : p === 'week' ? 'Semana' : 'Mês'}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-1 py-2">
            <ShimmerLine />
            <ShimmerLine />
            <ShimmerLine />
            <div className="bg-border/40 my-1.5 h-px" />
            <ShimmerLine />
            <ShimmerLine />
          </div>
        ) : stats ? (
          <div className="space-y-2">
            <StatLine label="Tokens totais" value={fmtNum(stats.usage.totalTokens)} />
            <StatLine
              label="Em cache"
              value={fmtNum(stats.usage.cachedTokens)}
              hint={stats.usage.totalTokens ? `${Math.round((stats.usage.cachedTokens / stats.usage.totalTokens) * 100)}%` : undefined}
            />
            <StatLine label="Custo estimado" value={fmtUSD(stats.usage.costMicrousd)} />
            <StatLine label="Turns de chat" value={String(stats.usage.chatTurns)} />

            <div className="bg-border/40 my-1.5 h-px" />

            <StatLine label="Artigos completos" value={String(stats.acervo.done)} />
            <StatLine label="Só resumo" value={String(stats.acervo.abstract)} />
            <StatLine label="Falhas" value={String(stats.acervo.failed)} />
            <StatLine label="Buscas executadas" value={String(stats.searches)} />
          </div>
        ) : (
          <p className="text-muted-foreground py-4 text-center text-[11px]">Sem dados disponíveis.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

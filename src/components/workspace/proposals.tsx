'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Terminal, Check, ChevronDown, ChevronUp, Globe, Activity, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared type
// ---------------------------------------------------------------------------
export type ExecuteSearchFn = (queries: string[], queryId: string, isGlobal?: boolean) => void;

// ---------------------------------------------------------------------------
// SearchAttempt — entrada da jornada de busca unificada
// ---------------------------------------------------------------------------
export interface SearchAttempt {
  type: 'sol' | 'global';
  toolCallId: string;
  queryId?: string;
  queries?: string[];  // SOL (múltiplas strings)
  query?: string;      // Global (única string)
  isExecuted: boolean;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// SearchJourneyCard — card único e dinâmico que agrega toda a jornada
// ---------------------------------------------------------------------------
interface SearchJourneyCardProps {
  attempts: SearchAttempt[];
  onCancel?: (queryId: string) => void;
}

export const SearchJourneyCard = ({ attempts, onCancel }: SearchJourneyCardProps) => {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!attempts.length) return null;

  const pastAttempts = attempts.slice(0, -1);
  const current = attempts[attempts.length - 1];

  const isRunning = current.isRunning;
  const isExecuted = current.isExecuted;
  const isPending = !isExecuted && !isRunning;
  const isGlobal = current.type === 'global';

  const typeLabel = (type: 'sol' | 'global') => (type === 'sol' ? 'SOL' : 'OpenAlex');
  const typeEmoji = (type: 'sol' | 'global') => (type === 'sol' ? '🔍' : '🌐');

  const currentQueryStr =
    current.type === 'sol'
      ? (current.queries ?? []).join(' | ')
      : (current.query ?? '');

  return (
    <div
      className={`border-border bg-card mt-3 overflow-hidden rounded-xl border shadow-sm${isGlobal ? ' border-amber-200/60 dark:border-amber-800/40' : ''}`}
    >
      {/* ── Header ── */}
      <div
        className={`border-border/60 flex items-center justify-between border-b px-4 py-2.5${isGlobal ? ' bg-amber-50/60 dark:bg-amber-950/20' : ' bg-muted/30'}`}
      >
        <div className="flex items-center gap-2">
          <span className="select-none text-sm">🔬</span>
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Estratégia de Busca
          </span>
          {isGlobal && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:bg-amber-900/50 dark:text-amber-300">
              OpenAlex
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && !isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              ✅ Executado
            </span>
          )}
          {isRunning && (
            <>
              <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase">
                <Loader2 className="h-3 w-3 animate-spin" /> Executando
              </span>
              {current.queryId && onCancel && (
                <button
                  type="button"
                  title="Cancelar busca"
                  onClick={() => onCancel(current.queryId!)}
                  className="ml-1 rounded p-0.5 text-blue-400 transition-colors hover:bg-blue-500/20 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
          {isPending && (
            <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" /> Iniciando…
            </span>
          )}
        </div>
      </div>

      {/* ── Tentativas anteriores (colapsável) ── */}
      {pastAttempts.length > 0 && (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setHistoryOpen(!historyOpen)}
            onKeyDown={(e) =>
              e.key === 'Enter' || e.key === ' ' ? setHistoryOpen(!historyOpen) : undefined
            }
            className="border-border/40 text-muted-foreground hover:bg-muted/30 hover:text-foreground flex w-full cursor-pointer select-none items-center gap-2 border-b px-4 py-1.5 text-[10px] font-medium transition-colors"
          >
            {historyOpen ? (
              <ChevronUp className="h-3 w-3 opacity-50" />
            ) : (
              <ChevronDown className="h-3 w-3 opacity-50" />
            )}
            <span>
              {pastAttempts.length} tentativa{pastAttempts.length !== 1 ? 's' : ''} anterior
              {pastAttempts.length !== 1 ? 'es' : ''} sem resultados
            </span>
          </div>
          {historyOpen && (
            <div className="animate-in slide-in-from-top-1 bg-muted/5 border-border/40 space-y-2 border-b px-4 py-2.5 duration-150">
              {pastAttempts.map((a) => {
                const q =
                  a.type === 'sol' ? (a.queries ?? []).join(' | ') : (a.query ?? '');
                const qs = q.length > 72 ? q.slice(0, 72) + '…' : q;
                return (
                  <div key={a.toolCallId} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 select-none text-[11px]">
                      {typeEmoji(a.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-muted-foreground/80 text-[10px] font-semibold">
                        {typeLabel(a.type)}
                      </span>
                      <span className="text-muted-foreground/40 mx-1 text-[10px]">—</span>
                      <span className="text-muted-foreground/60 font-mono text-[10px]">{qs}</span>
                      <span className="ml-1.5 text-[10px] text-orange-400/80">↳ sem resultados</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Query atual ── */}
      <div className="bg-muted/10 space-y-1.5 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="select-none text-[11px]">{typeEmoji(current.type)}</span>
          <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
            {typeLabel(current.type)}
            {current.type === 'sol' ? ' — strings da busca:' : ' — query:'}
          </span>
        </div>
        {current.type === 'sol' ? (
          <div className="space-y-1">
            {(current.queries ?? []).map((q, i) => (
              <div
                key={i}
                className="bg-background overflow-x-auto rounded-md border border-border/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground/75"
              >
                {q}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-background overflow-x-auto rounded-md border border-border/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground/75">
            {currentQueryStr}
          </div>
        )}
        {current.type === 'sol' && (current.queries ?? []).length > 1 && (
          <p className="text-muted-foreground/50 text-[10px]">
            {(current.queries ?? []).length} strings · executadas em paralelo
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SearchProposalCard — busca SOL
// ---------------------------------------------------------------------------
interface SearchProposalCardProps {
  queries: string[];
  queryId?: string;
  onExecute?: ExecuteSearchFn;
  onCancel?: (queryId: string) => void;
  isExecuted?: boolean;
  isRunning?: boolean;
}

export const SearchProposalCard = ({
  queries,
  queryId,
  onExecute,
  onCancel,
  isExecuted,
  isRunning,
}: SearchProposalCardProps) => {
  const [editableQueries] = useState<string[]>(queries || []);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-border bg-card mt-3 overflow-hidden rounded-xl border shadow-sm">
      {/* Header clicável — div em vez de button para evitar button>button inválido no HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) =>
          e.key === 'Enter' || e.key === ' ' ? setIsExpanded(!isExpanded) : undefined
        }
        className="border-border/60 bg-muted/30 hover:bg-muted/50 flex w-full cursor-pointer items-center justify-between border-b px-4 py-2.5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="text-primary h-3.5 w-3.5" />
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Estratégia de Busca SOL ({editableQueries.length} string
            {editableQueries.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && !isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </span>
          )}
          {isExecuted && isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase">
              <Loader2 className="h-3 w-3 animate-spin" /> Executando
            </span>
          )}
          {isExecuted && isRunning && queryId && onCancel && (
            <button
              type="button"
              title="Cancelar busca"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(queryId);
              }}
              className="ml-1 rounded p-0.5 text-blue-400 transition-colors hover:bg-blue-500/20 hover:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {!isExecuted && !isRunning && (
            <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" /> Iniciando…
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
          )}
        </div>
      </div>

      {/* Strings da busca — somente leitura (execução automática) */}
      {isExpanded && (
        <div className="animate-in slide-in-from-top-1 fade-in border-border/60 bg-muted/10 space-y-2 border-b p-4 duration-200">
          <p className="text-muted-foreground mb-1 px-0.5 text-[10px] font-bold tracking-wider uppercase">
            Strings da busca:
          </p>
          {editableQueries.map((q: string, i: number) => (
            <Input
              key={i}
              value={q}
              readOnly
              title={q}
              className="bg-background focus-visible:ring-primary h-8 w-full cursor-default font-mono text-[11px] opacity-70 focus-visible:ring-0"
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GlobalSearchProposalCard — busca OpenAlex
// ---------------------------------------------------------------------------
interface GlobalSearchProposalCardProps {
  query: string;
  queryId?: string;
  onExecute?: ExecuteSearchFn;
  onCancel?: (queryId: string) => void;
  isExecuted?: boolean;
  isRunning?: boolean;
}

export const GlobalSearchProposalCard = ({
  query,
  queryId,
  onExecute,
  onCancel,
  isExecuted,
  isRunning,
}: GlobalSearchProposalCardProps) => {
  const [editableQuery] = useState<string>(query || '');
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-card mt-3 overflow-hidden rounded-xl border border-amber-200/60 shadow-sm dark:border-amber-800/40">
      {/* Header — div em vez de button para evitar button>button inválido no HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) =>
          e.key === 'Enter' || e.key === ' ' ? setIsExpanded(!isExpanded) : undefined
        }
        className="flex w-full cursor-pointer items-center justify-between border-b border-amber-200/40 bg-amber-50/60 px-4 py-2.5 transition-colors hover:bg-amber-50/80 dark:border-amber-800/30 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
      >
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[11px] font-bold tracking-tight text-amber-700 uppercase dark:text-amber-400">
            Busca Global (OpenAlex)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && !isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </span>
          )}
          {isExecuted && isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 uppercase">
              <Loader2 className="h-3 w-3 animate-spin" /> Executando
            </span>
          )}
          {isExecuted && isRunning && queryId && onCancel && (
            <button
              type="button"
              title="Cancelar busca global"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(queryId);
              }}
              className="ml-1 rounded p-0.5 text-blue-400 transition-colors hover:bg-amber-500/20 hover:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {!isExecuted && !isRunning && (
            <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" /> Iniciando…
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
          )}
        </div>
      </div>

      {/* Query — somente leitura (execução automática) */}
      {isExpanded && (
        <div className="animate-in slide-in-from-top-1 fade-in bg-muted/10 space-y-2 border-b border-amber-200/40 p-4 duration-200 dark:border-amber-800/30">
          <p className="text-muted-foreground mb-1 px-0.5 text-[10px] font-bold tracking-wider uppercase">
            Query da busca:
          </p>
          <Input
            value={editableQuery}
            readOnly
            title={editableQuery}
            className="bg-background h-8 w-full cursor-default font-mono text-[11px] opacity-70 focus-visible:ring-0 focus-visible:ring-amber-500"
          />
        </div>
      )}
    </div>
  );
};

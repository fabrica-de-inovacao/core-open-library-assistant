'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Terminal,
  Check,
  ChevronDown,
  ChevronUp,
  Play,
  Globe,
  Activity,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared type
// ---------------------------------------------------------------------------
export type ExecuteSearchFn = (queries: string[], queryId: string, isGlobal?: boolean) => void;

// ---------------------------------------------------------------------------
// SearchProposalCard
// ---------------------------------------------------------------------------
interface SearchProposalCardProps {
  queries: string[];
  queryId?: string;
  onExecute?: ExecuteSearchFn;
  isExecuted?: boolean;
  isRunning?: boolean;
}

export const SearchProposalCard = ({
  queries,
  queryId,
  onExecute,
  isExecuted,
  isRunning,
}: SearchProposalCardProps) => {
  const [editableQueries, setEditableQueries] = useState<string[]>(queries || []);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleQueryChange = (index: number, newValue: string) => {
    const updated = [...editableQueries];
    updated[index] = newValue;
    setEditableQueries(updated);
  };

  return (
    <div className="border-border bg-card/50 mt-4 overflow-hidden rounded-xl border shadow-sm backdrop-blur-sm">
      <div
        className="border-border bg-muted/30 hover:bg-muted/50 flex cursor-pointer items-center justify-between border-b px-4 py-2.5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Terminal className="text-primary h-4 w-4" />
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Estratégia de Busca SOL ({editableQueries.length} string
            {editableQueries.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-muted/10 border-border animate-in slide-in-from-top-1 fade-in border-b p-4 duration-200">
          <div className="space-y-2">
            {!isExecuted && (
              <div className="text-muted-foreground px-1 text-[10px] font-bold tracking-wider uppercase">
                Strings geradas (Edite se necessário):
              </div>
            )}
            {editableQueries.map((q: string, i: number) => (
              <Input
                key={i}
                value={q}
                onChange={(e) => handleQueryChange(i, e.target.value)}
                disabled={isExecuted}
                title={q}
                className={`bg-background focus-visible:ring-primary h-8 w-full font-mono text-[11px] focus-visible:ring-1 ${isExecuted ? 'cursor-not-allowed opacity-70' : ''}`}
              />
            ))}
          </div>
        </div>
      )}

      {!isExecuted && (
        <div className="bg-card/50 p-4">
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => queryId && onExecute?.(editableQueries, queryId)}
              disabled={!queryId || isRunning}
              className="w-full gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
              size="sm"
            >
              {!queryId ? (
                <>
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> Preparando
                  Card...
                </>
              ) : isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Executar Busca Agora
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GlobalSearchProposalCard
// ---------------------------------------------------------------------------
interface GlobalSearchProposalCardProps {
  query: string;
  queryId?: string;
  onExecute?: ExecuteSearchFn;
  isExecuted?: boolean;
  isRunning?: boolean;
}

export const GlobalSearchProposalCard = ({
  query,
  queryId,
  onExecute,
  isExecuted,
  isRunning,
}: GlobalSearchProposalCardProps) => {
  const [editableQuery, setEditableQuery] = useState<string>(query || '');
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-border bg-card/50 mt-4 overflow-hidden rounded-xl border shadow-sm backdrop-blur-sm">
      <div
        className="border-border bg-muted/30 hover:bg-muted/50 flex cursor-pointer items-center justify-between border-b px-4 py-2.5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-500" />
          <span className="text-[11px] font-bold tracking-tight uppercase">
            Busca Global (OpenAlex)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExecuted && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase">
              <Check className="h-3 w-3" /> Executado
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-muted/10 border-border animate-in slide-in-from-top-1 fade-in border-b p-4 duration-200">
          <div className="space-y-2">
            {!isExecuted && (
              <div className="text-muted-foreground px-1 text-[10px] font-bold tracking-wider uppercase">
                Editar Query (Opcional):
              </div>
            )}
            <Input
              value={editableQuery}
              onChange={(e) => setEditableQuery(e.target.value)}
              disabled={isExecuted}
              title={editableQuery}
              className={`bg-background h-8 w-full font-mono text-[11px] focus-visible:ring-1 focus-visible:ring-amber-500 ${isExecuted ? 'cursor-not-allowed opacity-70' : ''}`}
            />
          </div>
        </div>
      )}

      {!isExecuted && (
        <div className="bg-card/50 p-4">
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => queryId && onExecute?.([editableQuery], queryId, true)}
              disabled={!queryId || isRunning}
              className="w-full gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
              size="sm"
            >
              {!queryId ? (
                <>
                  <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> Preparando
                  Card...
                </>
              ) : isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando Global...
                </>
              ) : (
                <>
                  <Globe className="h-4 w-4" /> Executar Busca Global
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

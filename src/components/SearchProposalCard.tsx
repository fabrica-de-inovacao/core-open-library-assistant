'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Play,
  CheckCircle2,
  Loader2,
  Database,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';

interface SearchProposalCardProps {
  title?: string;
  source: 'sol' | 'openalex';
  queries: string[];
  isExecutedInitially?: boolean;
  onExecute: (queries: string[]) => Promise<void>;
}

export function SearchProposalCard({
  title = 'Proposta de Mapeamento Sistemático',
  source,
  queries: initialQueries,
  isExecutedInitially = false,
  onExecute,
}: SearchProposalCardProps) {
  const [queries, setQueries] = useState<string[]>(initialQueries);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isExecuted, setIsExecuted] = useState(isExecutedInitially);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const handleQueryChange = (idx: number, val: string) => {
    const newQ = [...queries];
    newQ[idx] = val;
    setQueries(newQ);
  };

  const handleExecute = async () => {
    if (isExecuted) return;
    setIsExecuting(true);
    try {
      await onExecute(queries);
      setIsExecuted(true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div
      className={`mt-3 mb-2 rounded-xl border border-l-4 p-4 shadow-sm transition-colors ${
        isExecuted
          ? 'border-emerald-100 border-l-emerald-500 bg-emerald-50/50 dark:border-emerald-900/50 dark:border-l-emerald-600/70 dark:bg-emerald-950/10'
          : source === 'openalex'
            ? 'bg-card border-l-violet-500 dark:border-l-violet-600'
            : 'border-l-primary bg-card'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <Database className={`h-4 w-4 ${source === 'sol' ? 'text-primary' : 'text-violet-500'}`} />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>

      <div className="mb-4 space-y-2">
        {!isExecuted ? (
          <>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                Foram elaboradas <strong>{queries.length}</strong> variações de string de busca.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="mr-1 h-3 w-3" /> Ocultar
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-1 h-3 w-3" /> Revisar e Editar
                  </>
                )}
              </Button>
            </div>

            {isExpanded && (
              <div className="animate-in fade-in slide-in-from-top-2 mt-4 space-y-2">
                {queries.map((q, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-4 text-right font-mono text-xs select-none">
                      {idx + 1}.
                    </span>
                    <Input
                      value={q}
                      onChange={(e) => handleQueryChange(idx, e.target.value)}
                      disabled={isExecuted || isExecuting}
                      className={`bg-muted/50 focus-visible:ring-primary h-8 font-mono text-[11px] focus-visible:ring-1 ${isExecuted || isExecuting ? 'cursor-not-allowed' : ''}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mt-2 flex flex-col items-start gap-2">
            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-medium text-emerald-700/90 dark:text-emerald-400/90">
                Buscando com {queries.length} variações.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-400"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="mr-1 h-3 w-3" /> Ocultar
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-1 h-3 w-3" /> Ver strings utilizadas
                  </>
                )}
              </Button>
            </div>
            {isExpanded && (
              <div className="animate-in fade-in slide-in-from-top-2 mt-2 w-full space-y-2">
                {queries.map((q, idx) => (
                  <div
                    key={idx}
                    className="group flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2"
                  >
                    <span className="text-muted-foreground mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] select-none">
                      {idx + 1}.
                    </span>
                    <span className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed break-all text-emerald-700/80 sm:text-[11px] dark:text-emerald-400/80">
                      {q}
                    </span>
                    <button
                      onClick={() => handleCopy(q, idx)}
                      title="Copiar string"
                      className="mt-0.5 shrink-0 rounded p-0.5 text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-emerald-500/20 dark:text-emerald-400"
                    >
                      {copiedIdx === idx ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        {isExecuted ? (
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Extração Iniciada</span>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={handleExecute}
            disabled={isExecuting || queries.some((q) => !q.trim())}
            className={`gap-2 shadow-sm ${
              source === 'openalex'
                ? 'bg-violet-600 text-white hover:bg-violet-700'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Iniciando...
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                Executar Busca
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * components/workspace/PipelineStatusBar.tsx
 *
 * Tira de status minimalista — exibida entre o chat e o input bar.
 * Design: linha fina + pill de status com steps sequenciais colapsáveis.
 *
 * Fases:
 *   searching      → Buscando no acervo
 *   processing     → Extraindo conteúdo (N/total)
 *   synthesizing   → Gerando TL;DRs (N/total)
 *   needs_refinement → Expandindo busca...
 *   done           → colapsa automaticamente em 1.5s
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PipelinePhase =
  | 'idle'
  | 'searching'
  | 'processing'
  | 'synthesizing'
  | 'needs_refinement'
  | 'done';

const TERMINAL = ['done', 'abstract_only', 'failed'] as const;

interface PipelineStatusBarProps {
  isSearchRunning: boolean;
  articles: Array<{ queryId?: string | null; status?: string | null }>;
  activeQueryId: string | null;
  queryStatus: string | null;
  isSynthesisRunning?: boolean;
  hasZeroResults?: boolean;
  className?: string;
}

// ─── Configuração de cada fase ────────────────────────────────────────────────

const PHASE_CONFIG: Record<
  Exclude<PipelinePhase, 'idle'>,
  { label: string; sublabel?: (ctx: PhaseContext) => string | null; indeterminate: boolean }
> = {
  searching: {
    label: 'Buscando artigos',
    sublabel: () => null,
    indeterminate: true,
  },
  needs_refinement: {
    label: 'Expandindo busca',
    sublabel: () => 'consultando OpenAlex...',
    indeterminate: true,
  },
  processing: {
    label: 'Extraindo conteúdo',
    sublabel: ({ terminalCount, total, pendingCount, extractingCount }) => {
      const parts: string[] = [];
      if (pendingCount > 0) parts.push(`${pendingCount} na fila`);
      if (extractingCount > 0) parts.push(`${extractingCount} lendo PDF`);
      if (parts.length === 0 && total > 0) return `${terminalCount}/${total}`;
      return parts.length > 0 ? parts.join(' · ') : null;
    },
    indeterminate: false,
  },
  synthesizing: {
    label: 'Gerando TL;DRs',
    sublabel: ({ synthCount, total }) =>
      synthCount > 0 ? `${synthCount} de ${total} em processamento` : null,
    indeterminate: false,
  },
  done: {
    label: 'Concluído',
    sublabel: ({ total }) => (total > 0 ? `${total} artigos processados` : null),
    indeterminate: false,
  },
};

interface PhaseContext {
  terminalCount: number;
  total: number;
  pendingCount: number;
  extractingCount: number;
  synthCount: number;
}

// ─── Step history item ────────────────────────────────────────────────────────

interface StepRecord {
  phase: Exclude<PipelinePhase, 'idle'>;
  startedAt: number;
  endedAt?: number;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PipelineStatusBar({
  isSearchRunning,
  articles,
  activeQueryId,
  queryStatus,
  isSynthesisRunning = false,
  hasZeroResults = false,
  className,
}: PipelineStatusBarProps) {
  // ── Contadores ──────────────────────────────────────────────────────────────
  const scopedArticles =
    queryStatus === 'done' || !activeQueryId
      ? articles
      : articles.filter((a) => a.queryId === activeQueryId);

  const total = scopedArticles.length;
  const terminalCount = scopedArticles.filter((a) =>
    TERMINAL.includes(a.status as (typeof TERMINAL)[number])
  ).length;
  const pendingCount = scopedArticles.filter((a) => a.status === 'pending').length;
  const extractingCount = scopedArticles.filter((a) => a.status === 'extracting').length;
  const synthCount = scopedArticles.filter((a) => a.status === 'llm_processing').length;
  const activeCount = total - terminalCount;

  const ctx: PhaseContext = { terminalCount, total, pendingCount, extractingCount, synthCount };

  // ── Derivar fase ────────────────────────────────────────────────────────────
  let phase: PipelinePhase = 'idle';

  // Verifica se o pipeline (busca, parser, LLM) está completamente ocioso e já finalizado
  const isPipelineDormant =
    queryStatus === 'done' &&
    !isSearchRunning &&
    !isSynthesisRunning &&
    activeCount === 0 &&
    synthCount === 0;

  if (isPipelineDormant) {
    // Se não há nada acontecendo e a query já concluiu, a barra fica invisível
    phase = 'idle';
  } else if (synthCount > 0 || isSynthesisRunning) {
    phase = 'synthesizing';
  } else if (queryStatus === 'done' && total > 0) {
    // Pipeline acabou de terminar o parsing mas ainda vamos exibir concluído
    // (A transição de state fará o hide após 1.5s)
    phase = 'done';
  } else if (
    queryStatus === 'needs_refinement' ||
    (hasZeroResults && !isSearchRunning && total === 0)
  ) {
    phase = 'needs_refinement';
  } else if (isSearchRunning && total === 0) {
    phase = 'searching';
  } else if (total > 0 && activeCount > 0) {
    phase = 'processing';
  } else if (isSearchRunning) {
    phase = 'searching';
  }

  // ── Histórico de steps ──────────────────────────────────────────────────────
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const prevPhaseRef = useRef<PipelinePhase>('idle');

  useEffect(() => {
    if (phase === prevPhaseRef.current) return;

    prevPhaseRef.current = phase;

    setTimeout(() => {
      setSteps((s) => {
        const updated = s.map((step, i) =>
          i === s.length - 1 && !step.endedAt ? { ...step, endedAt: Date.now() } : step
        );
        if (phase === 'idle') return updated;
        return [
          ...updated,
          { phase: phase as Exclude<PipelinePhase, 'idle'>, startedAt: Date.now() },
        ];
      });
    }, 0);
  }, [phase]);

  // Reset steps when completely done and hidden
  const resetStepsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Visibilidade / colapso ───────────────────────────────────────────────────
  const [visible, setVisible] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    if (resetStepsTimerRef.current) clearTimeout(resetStepsTimerRef.current);

    if (phase === 'idle') {
      collapseTimerRef.current = setTimeout(() => {
        setCollapsing(true);
        collapseTimerRef.current = setTimeout(() => {
          setVisible(false);
          setCollapsing(false);
        }, 300);
      }, 0);
      return () => {
        if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      };
    }

    setTimeout(() => {
      setVisible(true);
      setCollapsing(false);
    }, 0);

    if (phase === 'done') {
      // colapsa rapidamente após conclusão
      collapseTimerRef.current = setTimeout(() => {
        setCollapsing(true);
        collapseTimerRef.current = setTimeout(() => {
          setVisible(false);
          setCollapsing(false);
          // reset do histórico após sumir completamente
          resetStepsTimerRef.current = setTimeout(() => setSteps([]), 200);
        }, 300);
      }, 1_500);
    }

    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, [phase]);

  if (!visible && phase === 'idle') return null;

  const config = phase !== 'idle' ? PHASE_CONFIG[phase] : null;
  if (!config) return null;

  const sublabel = config.sublabel?.(ctx) ?? null;
  const progressPct = total > 0 && !config.indeterminate ? (terminalCount / total) * 100 : 0;
  const isDone = phase === 'done';

  return (
    <div
      className={cn(
        'px-4 pb-2 transition-all duration-300 ease-out',
        collapsing ? 'pointer-events-none -translate-y-1 opacity-0' : 'translate-y-0 opacity-100',
        className
      )}
    >
      <div className="mx-auto max-w-2xl">
        <div
          className={cn(
            'border-border/40 bg-muted/30 rounded-lg border backdrop-blur-sm',
            'overflow-hidden transition-all duration-300'
          )}
        >
          {/* ── Linha de progresso no topo ─────────────────────────────────── */}
          <div className="bg-border/30 relative h-[2px] w-full overflow-hidden">
            {config.indeterminate ? (
              <div className="bg-foreground/30 absolute h-full w-1/4 animate-[pipeline-scan_1.6s_ease-in-out_infinite]" />
            ) : isDone ? (
              <div className="bg-foreground/20 h-full w-full transition-all duration-700" />
            ) : (
              <div
                className="bg-foreground/40 h-full transition-all duration-700 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            )}
          </div>

          {/* ── Conteúdo principal ─────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-3.5 py-2">
            {/* Indicador de atividade */}
            <div className="flex shrink-0 items-center gap-1.5">
              {isDone ? (
                <svg
                  className="text-foreground/50 h-3 w-3"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="relative flex h-2 w-2">
                  <span className="bg-foreground/30 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                  <span className="bg-foreground/50 relative inline-flex h-2 w-2 rounded-full" />
                </span>
              )}
            </div>

            {/* Label + sub-label */}
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span
                className={cn(
                  'shrink-0 text-xs leading-none font-medium',
                  isDone ? 'text-foreground/40' : 'text-foreground/70'
                )}
              >
                {config.label}
              </span>
              {sublabel && (
                <span className="text-foreground/35 truncate text-[10px] leading-none">
                  {sublabel}
                </span>
              )}
            </div>

            {/* Chip de progresso */}
            {total > 0 && !isDone && (
              <span className="bg-muted text-foreground/40 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums">
                {terminalCount}/{total}
              </span>
            )}
          </div>

          {/* ── Step timeline (steps anteriores concluídos) ─────────────────── */}
          {steps.length > 1 && (
            <div className="border-border/20 flex flex-wrap gap-x-3 gap-y-0.5 border-t px-3.5 pt-1.5 pb-2">
              {steps.slice(0, -1).map((s, i) => {
                const elapsed = s.endedAt ? Math.round((s.endedAt - s.startedAt) / 1000) : null;
                return (
                  <span
                    key={i}
                    className="text-foreground/25 flex items-center gap-1 text-[9px] leading-none"
                  >
                    <svg
                      className="h-2 w-2"
                      viewBox="0 0 8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M1.5 4l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {PHASE_CONFIG[s.phase].label}
                    {elapsed !== null && ` · ${elapsed}s`}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

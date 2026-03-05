'use client';

/**
 * components/workspace/PipelineStatusBar.tsx
 *
 * Barra de status global do pipeline de extração — exibida acima do ChatInputBar.
 * Mostra o estado atual de cada fase com sub-status granular, sem poluir o chat.
 *
 * Pipeline real de status dos artigos:
 *   pending → extracting → llm_processing → done
 *                       ↓                 ↓
 *                  abstract_only        failed
 *
 * Fases da barra (mapeadas dos status acima):
 *   searching     → busca HTTP em andamento (sem artigos ainda)
 *   processing    → pending (fila Inngest) + extracting (Python worker)
 *   synthesizing  → llm_processing (geração de TL;DR)
 *   done          → todos terminais (auto-dismiss em 4s)
 *   needs_refinement → query rejeitada / poucos resultados (IA já age sozinha)
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PipelinePhase =
  | 'idle'
  | 'searching'
  | 'processing'
  | 'synthesizing'
  | 'done'
  | 'needs_refinement';

/**
 * Status terminais: artigo não vai mais mudar de estado.
 * 'failed' é incluído porque o pipeline encerrou (com erro).
 */
/**
 * Status terminais: artigo não vai mais mudar de estado.
 * 'failed' incluído porque o pipeline encerrou (com erro).
 */
const TERMINAL = ['done', 'abstract_only', 'failed'] as const;

interface PipelineStatusBarProps {
  isSearchRunning: boolean;
  /** Lista completa de artigos da sessão (filtrados por activeQueryId internamente) */
  articles: Array<{ queryId?: string | null; status?: string | null }>;
  activeQueryId: string | null;
  /** Status da query ativa no DB (via useSupabaseRealtime → polling + Realtime) */
  queryStatus: string | null;
  /** true quando generate_systematic_review está em execução — evita dismiss prematuro */
  isSynthesisRunning?: boolean;
  /** true quando a busca ativa retornou 0 resultados ou erro — IA já está refinando */
  hasZeroResults?: boolean;
  className?: string;
}

// ─── Configuração visual por fase ────────────────────────────────────────────

const PHASE_CONFIG = {
  searching: {
    emoji: '🔍',
    label: 'Buscando artigos',
    dotClass: 'bg-blue-400',
    textClass: 'text-blue-700 dark:text-blue-300',
    bgClass:
      'from-blue-50/90 to-sky-50/70 border-blue-200/60 dark:from-blue-950/50 dark:to-sky-950/40 dark:border-blue-800/40',
    trackClass: 'bg-blue-500/15',
    fillClass: 'bg-blue-400',
    countClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300',
    indeterminate: true,
  },
  processing: {
    emoji: '⚙️',
    label: 'Extraindo conteúdo',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-700 dark:text-amber-300',
    bgClass:
      'from-amber-50/90 to-orange-50/70 border-amber-200/60 dark:from-amber-950/50 dark:to-orange-950/40 dark:border-amber-800/40',
    trackClass: 'bg-amber-500/15',
    fillClass: 'bg-amber-400',
    countClass: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300',
    indeterminate: false,
  },
  synthesizing: {
    emoji: '🧠',
    label: 'Gerando sínteses',
    dotClass: 'bg-violet-400',
    textClass: 'text-violet-700 dark:text-violet-300',
    bgClass:
      'from-violet-50/90 to-purple-50/70 border-violet-200/60 dark:from-violet-950/50 dark:to-purple-950/40 dark:border-violet-800/40',
    trackClass: 'bg-violet-500/15',
    fillClass: 'bg-violet-400',
    countClass: 'bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-300',
    indeterminate: false,
  },
  done: {
    emoji: '✅',
    label: 'Processamento concluído',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    bgClass:
      'from-emerald-50/90 to-green-50/70 border-emerald-200/60 dark:from-emerald-950/50 dark:to-green-950/40 dark:border-emerald-800/40',
    trackClass: 'bg-emerald-500/15',
    fillClass: 'bg-emerald-400',
    countClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300',
    indeterminate: false,
  },
  needs_refinement: {
    emoji: '🔄',
    label: 'Refinando estratégia',
    dotClass: 'bg-orange-400',
    textClass: 'text-orange-700 dark:text-orange-300',
    bgClass:
      'from-orange-50/90 to-amber-50/70 border-orange-200/60 dark:from-orange-950/50 dark:to-amber-950/40 dark:border-orange-800/40',
    trackClass: 'bg-orange-500/15',
    fillClass: 'bg-orange-400',
    countClass: 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300',
    indeterminate: true,
  },
} satisfies Record<Exclude<PipelinePhase, 'idle'>, object>;

// ─── Componente ───────────────────────────────────────────────────────────────

export function PipelineStatusBar({
  isSearchRunning,
  articles,
  activeQueryId,
  queryStatus,
  isSynthesisRunning = false,
  hasZeroResults = false,
  className,
}: PipelineStatusBarProps) {
  // ── Contadores granulares por sub-status ──────────────────────────────────
  // Quando concluída (queryStatus='done') usa TODOS os artigos da sessão — sessões
  // multi-query (SOL + OpenAlex) teriam contagem incorreta se filtrassemos só pela
  // última activeQueryId.
  const scopedArticles =
    queryStatus === 'done' || !activeQueryId
      ? articles
      : articles.filter((a) => a.queryId === activeQueryId);

  const total         = scopedArticles.length;
  const terminalCount = scopedArticles.filter((a) =>
    TERMINAL.includes(a.status as (typeof TERMINAL)[number])
  ).length;
  const pendingCount    = scopedArticles.filter((a) => a.status === 'pending').length;
  const extractingCount = scopedArticles.filter((a) => a.status === 'extracting').length;
  const synthCount      = scopedArticles.filter((a) => a.status === 'llm_processing').length;
  const activeCount     = total - terminalCount;

  // ── Derivar fase de nível superior ────────────────────────────────────────
  let phase: PipelinePhase = 'idle';

  // synthCount tem prioridade máxima: impede que queryStatus='done' descarte
  // a barra enquanto artigos ainda estão em llm_processing (TL;DRs).
  // isSynthesisRunning cobre o gap entre done e o início do generate_systematic_review.
  if (synthCount > 0 || isSynthesisRunning) {
    phase = 'synthesizing';
  } else if (queryStatus === 'done' && total > 0) {
    phase = 'done';
  } else if (
    queryStatus === 'needs_refinement' ||
    (hasZeroResults && !isSearchRunning && total === 0)
  ) {
    // needs_refinement do DB OU erro de busca (502/sem resultados) — IA já age sozinha
    phase = 'needs_refinement';
  } else if (isSearchRunning && total === 0) {
    phase = 'searching';
  } else if (total > 0 && activeCount > 0) {
    phase = 'processing';
  } else if (isSearchRunning) {
    phase = 'searching';
  }

  // ── Label detalhado com sub-status ────────────────────────────────────────
  function buildDetailLabel(): string | null {
    if (phase === 'processing') {
      const parts: string[] = [];
      if (pendingCount > 0)    parts.push(`${pendingCount} na fila`);
      if (extractingCount > 0) parts.push(`${extractingCount} extraindo PDF`);
      if (parts.length === 0)  return total > 0 ? `${terminalCount}/${total}` : null;
      return parts.join(' · ');
    }
    if (phase === 'synthesizing') {
      const parts: string[] = [];
      if (pendingCount + extractingCount > 0)
        parts.push(`${pendingCount + extractingCount} aguardando`);
      if (synthCount > 0) parts.push(`${synthCount} gerando TL;DR`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    if (total > 0) return `${terminalCount}/${total} artigos`;
    return null;
  }

  const detailLabel = buildDetailLabel();
  // ── Histórico de fases (para o painel expansível) ────────────────────────
  const [phaseLogs, setPhaseLogs] = useState<Array<Exclude<PipelinePhase, 'idle'>>>([]);
  const prevPhaseRef = useRef<PipelinePhase>('idle');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (phase !== 'idle' && phase !== prevPhaseRef.current) {
      prevPhaseRef.current = phase;
      // Deferir setState para evitar atualização síncrona no corpo do effect (React Compiler)
      setTimeout(() => {
        setPhaseLogs((prev) => {
          if (prev[prev.length - 1] === phase) return prev;
          return [...prev, phase];
        });
      }, 0);
    }
  }, [phase]);
  // ── Estado de visibilidade / animação ────────────────────────────────────
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Limpar timers antigos ao mudar de fase
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    if (phase === 'idle') {
      // Deferir setState para evitar atualização síncrona no corpo do effect (React Compiler)
      fadeTimerRef.current = setTimeout(() => {
        setFading(true);
        fadeTimerRef.current = setTimeout(() => {
          setVisible(false);
          setFading(false);
        }, 400);
      }, 0);
      return () => {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      };
    }

    // Deferir setState para evitar atualização síncrona no corpo do effect (React Compiler)
    fadeTimerRef.current = setTimeout(() => {
      setVisible(true);
      setFading(false);
    }, 0);

    // Auto-dismiss após "done"
    if (phase === 'done') {
      dismissTimerRef.current = setTimeout(() => {
        setFading(true);
        fadeTimerRef.current = setTimeout(() => {
          setVisible(false);
          setFading(false);
        }, 500);
      }, 4_000);
    }

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [phase]);

  if (!visible && phase === 'idle') return null;

  const config = phase !== 'idle' ? PHASE_CONFIG[phase] : null;
  if (!config) return null;

  const { emoji, label, dotClass, textClass, bgClass, trackClass, fillClass, countClass, indeterminate } =
    config as {
      emoji: string;
      label: string;
      dotClass: string;
      textClass: string;
      bgClass: string;
      trackClass: string;
      fillClass: string;
      countClass: string;
      indeterminate: boolean;
    };
  const progressPct = total > 0 && !indeterminate ? (terminalCount / total) * 100 : 0;

  return (
    <div className={cn('bg-background/95 px-4 pb-1 backdrop-blur-sm', className)}>
      <div
        className={cn(
          'mx-auto max-w-2xl',
          'transition-all duration-500 ease-out',
          fading ? 'translate-y-2 scale-[0.98] opacity-0' : 'translate-y-0 scale-100 opacity-100',
          phase === 'done' && !expanded && 'opacity-60',
        )}
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border bg-gradient-to-r backdrop-blur-sm',
            bgClass
          )}
        >
          {/* ── Linha principal ── */}
          <div className="flex items-center gap-2.5 px-3.5 py-2">
            {/* Emoji com dot pulsante para fases ativas */}
            <div className="relative flex shrink-0 items-center">
              <span className="select-none text-sm leading-none">{emoji}</span>
              {phase !== 'done' && (
                <span
                  className={cn(
                    'absolute -top-1 -right-1 h-2 w-2 animate-ping rounded-full opacity-70',
                    dotClass
                  )}
                />
              )}
            </div>

            {/* Label principal */}
            <span className={cn('text-xs font-semibold leading-none', textClass)}>{label}</span>

            {/* Sub-status detalhado */}
            {detailLabel ? (
              <span className={cn('min-w-0 flex-1 truncate text-[10px] opacity-60', textClass)}>
                · {detailLabel}
              </span>
            ) : (
              <span className="flex-1" />
            )}

            {/* Chip de contagem de artigos */}
            {total > 0 && (
              <div
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums leading-none',
                  countClass
                )}
              >
                {phase === 'done' ? `${total} artigos` : `${terminalCount}/${total}`}
              </div>
            )}

            {/* Botão de toggle do histórico de fases */}
            {phaseLogs.length > 1 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className={cn(
                  'ml-0.5 shrink-0 rounded-md p-0.5 transition-opacity hover:opacity-80',
                  textClass
                )}
                aria-label={expanded ? 'Recolher histórico' : 'Ver histórico'}
              >
                <ChevronDown
                  className={cn('h-3 w-3 transition-transform duration-200', expanded && 'rotate-180')}
                />
              </button>
            )}
          </div>

          {/* ── Histórico de fases (expansível) ── */}
          {expanded && phaseLogs.length > 1 && (
            <div className="border-t border-current/10 px-3.5 pb-2 pt-1.5">
              {phaseLogs.slice(0, -1).map((p, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-1.5 py-0.5 text-[10px] opacity-50',
                    textClass
                  )}
                >
                  <span>{PHASE_CONFIG[p].emoji}</span>
                  <span>{PHASE_CONFIG[p].label}</span>
                  <span className="ml-auto">&#10003;</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Barra de progresso (ocultada no estado done) ── */}
          {phase !== 'done' && (
            <div className={cn('h-0.5 w-full', trackClass)}>
              {indeterminate ? (
                <div
                  className={cn(
                    'h-full w-1/3 rounded-full',
                    fillClass,
                    'animate-[progress-scan_1.8s_ease-in-out_infinite]'
                  )}
                />
              ) : (
                <div
                  className={cn('h-full rounded-full transition-all duration-700 ease-out', fillClass)}
                  style={{ width: `${progressPct}%` }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

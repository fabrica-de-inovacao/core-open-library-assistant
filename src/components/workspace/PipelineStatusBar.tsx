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
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Search, BrainCircuit, FileSearch2 } from 'lucide-react';

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
  className?: string;
}

// ─── Configuração visual por fase ────────────────────────────────────────────

const PHASE_CONFIG = {
  searching: {
    icon: Search,
    label: 'Buscando artigos…',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-600 dark:text-blue-400',
    trackClass: 'bg-blue-500/20',
    fillClass: 'bg-blue-500',
    indeterminate: true,
  },
  processing: {
    icon: FileSearch2,
    label: 'Extraindo conteúdo dos artigos',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
    trackClass: 'bg-amber-500/20',
    fillClass: 'bg-amber-500',
    indeterminate: false,
  },
  synthesizing: {
    icon: BrainCircuit,
    label: 'Gerando sínteses',
    dotClass: 'bg-violet-500',
    textClass: 'text-violet-600 dark:text-violet-400',
    trackClass: 'bg-violet-500/20',
    fillClass: 'bg-violet-500',
    indeterminate: false,
  },
  done: {
    icon: CheckCircle2,
    label: 'Processamento concluído',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    trackClass: 'bg-emerald-500/20',
    fillClass: 'bg-emerald-500',
    indeterminate: false,
  },
  needs_refinement: {
    icon: AlertTriangle,
    label: 'Refinando estratégia de busca…',
    dotClass: 'bg-orange-500',
    textClass: 'text-orange-600 dark:text-orange-400',
    trackClass: 'bg-orange-500/20',
    fillClass: 'bg-orange-500',
    indeterminate: true,
  },
} satisfies Record<Exclude<PipelinePhase, 'idle'>, object>;

// ─── Componente ───────────────────────────────────────────────────────────────

export function PipelineStatusBar({
  isSearchRunning,
  articles,
  activeQueryId,
  queryStatus,
  className,
}: PipelineStatusBarProps) {
  // ── Contadores granulares por sub-status ──────────────────────────────────
  const activeArticles = activeQueryId ? articles.filter((a) => a.queryId === activeQueryId) : [];

  const total         = activeArticles.length;
  const terminalCount = activeArticles.filter((a) =>
    TERMINAL.includes(a.status as (typeof TERMINAL)[number])
  ).length;
  const pendingCount    = activeArticles.filter((a) => a.status === 'pending').length;
  const extractingCount = activeArticles.filter((a) => a.status === 'extracting').length;
  const synthCount      = activeArticles.filter((a) => a.status === 'llm_processing').length;
  const activeCount     = total - terminalCount;

  // ── Derivar fase de nível superior ────────────────────────────────────────
  let phase: PipelinePhase = 'idle';

  if (queryStatus === 'done' && total > 0) {
    phase = 'done';
  } else if (queryStatus === 'needs_refinement') {
    phase = 'needs_refinement';
  } else if (synthCount > 0) {
    // Síntese tem prioridade visual — mesmo que ainda haja artigos sendo extraídos
    phase = 'synthesizing';
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
      setFading(true);
      fadeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setFading(false);
      }, 400);
      return;
    }

    setVisible(true);
    setFading(false);

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

  const { icon: Icon, label, dotClass, textClass, trackClass, fillClass, indeterminate } = config;
  const progressPct = total > 0 && !indeterminate ? (terminalCount / total) * 100 : 0;

  return (
    <div
      className={cn(
        'border-border/40 bg-background/80 mx-4 mb-1 overflow-hidden rounded-lg border backdrop-blur-sm',
        'transition-all duration-400',
        fading ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100',
        className
      )}
    >
      {/* ── Linha principal ── */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        {/* Ícone + dot pulsante enquanto ativo */}
        <div className="relative shrink-0">
          <Icon className={cn('h-3.5 w-3.5', textClass)} />
          {phase !== 'done' && (
            <span className={cn('absolute -top-0.5 -right-0.5 h-1.5 w-1.5 animate-ping rounded-full', dotClass)} />
          )}
        </div>

        {/* Label principal */}
        <span className={cn('text-xs font-medium', textClass)}>{label}</span>

        {/* Sub-status detalhado */}
        {detailLabel ? (
          <span className="text-foreground/40 flex-1 truncate text-[10px]">— {detailLabel}</span>
        ) : (
          <span className="flex-1" />
        )}

        {/* Artigos ainda ativos (canto direito) */}
        {activeCount > 0 && (
          <span className="text-foreground/40 shrink-0 font-mono text-[10px]">
            {activeCount} ativo{activeCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Barra de progresso ── */}
      <div className={cn('h-0.5 w-full', trackClass)}>
        {indeterminate ? (
          // Progresso indeterminado — animação de varredura
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
    </div>
  );
}

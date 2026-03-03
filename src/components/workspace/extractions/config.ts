import { Clock, RefreshCw, BrainCircuit, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import type React from 'react';

export const PAGE_SIZE = 20;

export const TERMINAL_STATUSES = ['done', 'abstract_only', 'failed'] as const;

export const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    classes: string;
    ping?: boolean;
  }
> = {
  pending: {
    label: 'Na fila',
    Icon: Clock,
    classes:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600/30 dark:bg-slate-600/10 dark:text-slate-400',
    ping: true,
  },
  extracting: {
    label: 'Extraindo',
    Icon: RefreshCw,
    classes:
      'border-primary/30 bg-primary/5 text-primary dark:border-primary/30 dark:bg-primary/10',
    ping: true,
  },
  processing: {
    label: 'Processando',
    Icon: RefreshCw,
    classes:
      'border-primary/30 bg-primary/5 text-primary dark:border-primary/30 dark:bg-primary/10',
    ping: true,
  },
  llm_processing: {
    label: 'Sintetizando',
    Icon: BrainCircuit,
    classes:
      'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400',
    ping: true,
  },
  done: {
    label: 'Concluído',
    Icon: CheckCircle2,
    classes:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400',
  },
  abstract_only: {
    label: 'Abstract',
    Icon: FileText,
    classes:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
  },
  failed: {
    label: 'Erro',
    Icon: AlertCircle,
    classes:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400',
  },
};

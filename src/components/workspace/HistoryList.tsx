'use client';

// Fase 6 (P-22): HistoryList — listagem interativa de revisões com seleção múltipla, filtros e gestão.

import React, { useState, useMemo, useTransition, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  CheckCircle2,
  FileText,
  ChevronDown,
  Download,
  ArrowRight,
  Layers,
  Unlock,
  FileSearch,
  MoreHorizontal,
  Trash2,
  Share2,
  Pencil,
  Check,
  X,
  SquareStack,
  SortDesc,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShareDialog } from '@/components/ShareDialog';
import { deleteSessions, renameSession } from '@/server/actions/history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryRowSerialized {
  id: string;
  displayTitle: string;
  status: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  articleCount: number;
  doneCount: number;
  tldrCount: number;
  openAccessCount: number;
  queryCount: number;
  chatId: string | null;
}

type FilterKey = 'all' | 'done' | 'active' | 'proposed';
type SortKey = 'newest' | 'oldest' | 'mostArticles' | 'name';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const timeStr = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    date
  );
  if (diffDays === 0) return `hoje às ${timeStr}`;
  if (diffDays === 1) return `ontem às ${timeStr}`;
  if (diffDays < 7) return `há ${diffDays} dias`;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const STATUS_CONFIG: Record<string, { label: string; dot: string }> = {
  done: { label: 'Concluída', dot: 'bg-emerald-500' },
  processing: { label: 'Processando', dot: 'bg-amber-400 animate-pulse' },
  searching: { label: 'Buscando', dot: 'bg-blue-400 animate-pulse' },
  proposed: { label: 'Proposta', dot: 'bg-muted-foreground/35' },
  failed: { label: 'Falhou', dot: 'bg-rose-500' },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, dot: 'bg-muted-foreground/35' };
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatChip({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  if (value === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
      <span className="opacity-40">{icon}</span>
      <span className="text-foreground/65 font-medium tabular-nums">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HistoryListProps {
  initialRows: HistoryRowSerialized[];
  initialHasMore: boolean;
  initialNextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HistoryList({ initialRows, initialHasMore, initialNextCursor }: HistoryListProps) {
  // ── Data state
  const [rows, setRows] = useState<HistoryRowSerialized[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ── Filter / sort
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // ── Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectMode = selectedIds.size > 0;

  // ── Modals
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null); // pending delete IDs
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareSessionId, setShareSessionId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Mutations
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Focus rename input when modal opens
  useEffect(() => {
    if (renameTarget) setTimeout(() => renameInputRef.current?.focus(), 50);
  }, [renameTarget]);

  // ── Filtered + sorted rows
  const displayRows = useMemo(() => {
    let filtered = rows;

    switch (filter) {
      case 'done':
        filtered = rows.filter((r) => r.status === 'done');
        break;
      case 'active':
        filtered = rows.filter((r) => r.status === 'searching' || r.status === 'processing');
        break;
      case 'proposed':
        filtered = rows.filter((r) => r.status === 'proposed' || r.status === 'failed');
        break;
    }

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'mostArticles':
          return b.articleCount - a.articleCount;
        case 'name':
          return a.displayTitle.localeCompare(b.displayTitle, 'pt-BR');
        default: // newest
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [rows, filter, sort]);

  // ── Filter counts
  const counts = useMemo(
    () => ({
      all: rows.length,
      done: rows.filter((r) => r.status === 'done').length,
      active: rows.filter((r) => r.status === 'searching' || r.status === 'processing').length,
      proposed: rows.filter((r) => r.status === 'proposed' || r.status === 'failed').length,
    }),
    [rows]
  );

  // ── Handlers: selection
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === displayRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayRows.map((r) => r.id)));
    }
  }, [selectedIds.size, displayRows]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Handler: load more
  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `/workspace/history?cursor=${encodeURIComponent(nextCursor)}&_data=1`,
        { headers: { Accept: 'application/json' } }
      );
      // Fallback: se a rota não suporta JSON, usamos navegação normal
      if (!res.ok) {
        window.location.href = `/workspace/history?cursor=${encodeURIComponent(nextCursor)}`;
        return;
      }
      const data = await res.json();
      if (data?.rows) {
        setRows((prev) => [...prev, ...data.rows]);
        setHasMore(data.hasMore ?? false);
        setNextCursor(data.nextCursor ?? null);
      }
    } catch {
      // fallback para link de página
      window.location.href = `/workspace/history?cursor=${encodeURIComponent(nextCursor)}`;
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  // ── Handler: delete
  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    const ids = [...deleteTarget];
    setMutationError(null);
    startTransition(async () => {
      const result = await deleteSessions(ids);
      if (result.ok) {
        setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
        setSelectedIds((prev) => {
          const n = new Set(prev);
          ids.forEach((id) => n.delete(id));
          return n;
        });
        setDeleteTarget(null);
      } else {
        setMutationError(result.error ?? 'Erro ao excluir.');
      }
    });
  }, [deleteTarget]);

  // ── Handler: rename confirm
  const handleRenameConfirm = useCallback(() => {
    if (!renameTarget || !renameValue.trim()) return;
    const id = renameTarget;
    const title = renameValue.trim();
    setMutationError(null);
    startTransition(async () => {
      const result = await renameSession(id, title);
      if (result.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, displayTitle: title } : r)));
        setRenameTarget(null);
      } else {
        setMutationError(result.error ?? 'Erro ao renomear.');
      }
    });
  }, [renameTarget, renameValue]);

  // ── Handler: bulk export (BibTeX)
  const handleBulkExport = useCallback(
    (format: string) => {
      const ids = Array.from(selectedIds);
      const idsWithArticles = rows.filter(
        (r) => ids.includes(r.id) && r.chatId && r.articleCount > 0
      );
      idsWithArticles.forEach((r, i) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = `/api/export?chat_id=${r.chatId}&format=${format}`;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, i * 300);
      });
    },
    [selectedIds, rows]
  );

  // ── Sort label
  const SORT_LABELS: Record<SortKey, string> = {
    newest: 'Mais recentes',
    oldest: 'Mais antigas',
    mostArticles: 'Mais artigos',
    name: 'Nome A→Z',
  };

  // ── Filter labels
  const FILTER_CONFIG: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'done', label: 'Concluídas' },
    { key: 'active', label: 'Em curso' },
    { key: 'proposed', label: 'Propostas' },
  ];

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="bg-background/95 sticky top-0 z-10 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[700px] items-center gap-2 px-4 py-2.5">
          {isSelectMode ? (
            /* Modo seleção */
            <>
              <button
                onClick={clearSelection}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={toggleSelectAll}
                className="text-foreground/70 hover:text-foreground rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              >
                {selectedIds.size === displayRows.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
              <span className="text-muted-foreground/60 text-[12px]">
                <span className="text-foreground/80 font-semibold tabular-nums">
                  {selectedIds.size}
                </span>{' '}
                selecionada{selectedIds.size !== 1 ? 's' : ''}
              </span>

              {/* Ações bulk — empurradas para a direita */}
              <div className="ml-auto flex items-center gap-1.5">
                {/* Export BibTeX */}
                <button
                  onClick={() => handleBulkExport('bibtex')}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
                  title="Exportar BibTeX das selecionadas"
                >
                  <Download className="h-3 w-3" />
                  BibTeX
                </button>
                {/* Export RIS */}
                <button
                  onClick={() => handleBulkExport('ris')}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
                  title="Exportar RIS (EndNote, Mendeley) das selecionadas"
                >
                  <Download className="h-3 w-3" />
                  RIS
                </button>
                {/* Excluir */}
                <button
                  onClick={() => setDeleteTarget(Array.from(selectedIds))}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-rose-500/80 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                >
                  <Trash2 className="h-3 w-3" />
                  Excluir
                </button>
              </div>
            </>
          ) : (
            /* Modo normal: filtros + sort */
            <>
              {/* Filter chips */}
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {FILTER_CONFIG.map(({ key, label }) => {
                  const c = counts[key];
                  const active = filter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={[
                        'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                        active
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                      ].join(' ')}
                    >
                      {label}
                      {c > 0 && !active && (
                        <span className="text-muted-foreground/50 text-[10px] tabular-nums">
                          {c}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sort */}
              <div className="ml-auto shrink-0">
                <DropdownMenu open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors">
                      <SortDesc className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          setSort(key);
                          setSortMenuOpen(false);
                        }}
                        className="flex items-center justify-between text-[13px]"
                      >
                        {SORT_LABELS[key]}
                        {sort === key && <Check className="text-primary h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </div>
        {/* Divisor */}
        <div className="bg-border/30 h-px" />
      </div>

      {/* ── Lista ───────────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-[700px] space-y-2.5 px-4 py-5">
        {displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground text-[14px]">Nenhuma revisão neste filtro.</p>
            <button
              onClick={() => setFilter('all')}
              className="text-primary mt-2 text-[13px] font-medium underline-offset-2 hover:underline"
            >
              Ver todas
            </button>
          </div>
        ) : (
          displayRows.map((row) => {
            const selected = selectedIds.has(row.id);
            return (
              <article
                key={row.id}
                className={[
                  'group relative rounded-2xl border transition-all',
                  selected
                    ? 'border-primary/40 bg-primary/[0.03] shadow-[0_0_0_2px_hsl(var(--primary)/0.12)]'
                    : 'border-border/50 bg-background hover:border-border/80 shadow-[0_1px_3px_0_rgba(0,0,0,0.04)] hover:shadow-[0_3px_14px_0_rgba(0,0,0,0.07)]',
                ].join(' ')}
              >
                {/* Checkbox — aparece no hover ou select mode */}
                <div
                  className={[
                    'absolute top-[18px] left-4 z-10 transition-opacity',
                    isSelectMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  ].join(' ')}
                >
                  <button
                    onClick={() => toggleSelect(row.id)}
                    className={[
                      'flex h-4.5 w-4.5 items-center justify-center rounded-md border transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:border-primary/60',
                    ].join(' ')}
                    aria-label={selected ? 'Desmarcar' : 'Selecionar'}
                  >
                    {selected && <Check className="h-2.5 w-2.5" />}
                  </button>
                </div>

                {/* Corpo */}
                <div
                  className={[
                    'p-5 transition-all',
                    isSelectMode || selected ? 'pl-10' : 'group-hover:pl-10',
                  ].join(' ')}
                >
                  {/* Status + data + menu */}
                  <div className="mb-2.5 flex items-center gap-3">
                    <StatusPill status={row.status} />
                    <span className="text-muted-foreground/40 text-[11px] tabular-nums">
                      {formatRelativeDate(row.createdAt)}
                    </span>

                    {/* Três pontinhos — menu de ações */}
                    <div className="ml-auto">
                      <CardMenu
                        row={row}
                        onDelete={() => setDeleteTarget([row.id])}
                        onRename={() => {
                          setRenameTarget(row.id);
                          setRenameValue(row.displayTitle);
                        }}
                        onShare={() => row.chatId && setShareSessionId(row.chatId)}
                      />
                    </div>
                  </div>

                  {/* Título */}
                  <p
                    className="text-foreground/90 group-hover:text-foreground mb-3.5 line-clamp-2 text-[15px] leading-snug font-semibold tracking-[-0.01em] transition-colors"
                    title={row.displayTitle}
                  >
                    {row.displayTitle}
                  </p>

                  {/* Stats chips */}
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                    <StatChip
                      icon={<BookOpen className="h-3 w-3" />}
                      value={row.articleCount}
                      label={`artigo${row.articleCount !== 1 ? 's' : ''}`}
                    />
                    {row.doneCount > 0 && row.doneCount < row.articleCount && (
                      <StatChip
                        icon={<CheckCircle2 className="h-3 w-3" />}
                        value={row.doneCount}
                        label="extraídos"
                      />
                    )}
                    {row.tldrCount > 0 && (
                      <StatChip
                        icon={<FileText className="h-3 w-3" />}
                        value={row.tldrCount}
                        label="TL;DR"
                      />
                    )}
                    {row.openAccessCount > 0 && (
                      <StatChip
                        icon={<Unlock className="h-3 w-3" />}
                        value={row.openAccessCount}
                        label="open access"
                      />
                    )}
                    {row.queryCount > 1 && (
                      <StatChip
                        icon={<Layers className="h-3 w-3" />}
                        value={row.queryCount}
                        label={`busca${row.queryCount !== 1 ? 's' : ''}`}
                      />
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div
                  className={[
                    'border-border/25 flex items-center justify-between border-t px-5 py-3 transition-all',
                    isSelectMode || selected ? 'pl-10' : 'group-hover:pl-10',
                  ].join(' ')}
                >
                  <span className="text-muted-foreground/30 text-[10.5px]">
                    Atualizado {formatRelativeDate(row.updatedAt)}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {row.chatId && row.articleCount > 0 && (
                      <a
                        href={`/api/export?chat_id=${row.chatId}&format=bibtex`}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground/60 hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
                        title="Exportar referências em BibTeX"
                      >
                        <Download className="h-3 w-3" />
                        BibTeX
                      </a>
                    )}

                    {(row.status === 'done' ||
                      row.status === 'processing' ||
                      row.articleCount > 0) && (
                      <Link
                        href={
                          row.chatId
                            ? `/workspace/chat/${row.chatId}`
                            : `/workspace?query_id=${row.id}`
                        }
                        onClick={(e) => {
                          if (isSelectMode) {
                            e.preventDefault();
                            toggleSelect(row.id);
                          }
                        }}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
                      >
                        Continuar
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}

                    {row.status === 'proposed' && row.articleCount === 0 && row.chatId && (
                      <Link
                        href={`/workspace/chat/${row.chatId}`}
                        onClick={(e) => {
                          if (isSelectMode) {
                            e.preventDefault();
                            toggleSelect(row.id);
                          }
                        }}
                        className="text-muted-foreground/70 hover:text-foreground hover:bg-muted flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
                      >
                        <FileSearch className="h-3 w-3" />
                        Ver sessão
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}

        {/* Load more */}
        {hasMore && nextCursor && (
          <div className="flex justify-center pt-2 pb-6">
            <button
              onClick={loadMore}
              disabled={isLoadingMore}
              className="border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-2 rounded-xl border px-5 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-50"
            >
              {isLoadingMore ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Carregar mais
            </button>
          </div>
        )}

        {/* Paginação: contagem */}
        {displayRows.length > 0 && (
          <p className="text-muted-foreground/40 pb-4 text-center text-[11px]">
            {displayRows.length} de {rows.length} revisão{rows.length !== 1 ? 'ões' : ''} carregada
            {rows.length !== 1 ? 's' : ''}
            {hasMore ? ' — há mais' : ''}
          </p>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
            </div>
            <DialogTitle className="text-[16px]">
              Excluir{' '}
              {deleteTarget && deleteTarget.length > 1
                ? `${deleteTarget.length} revisões`
                : 'revisão'}
              ?
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Todos os artigos, TL;DRs e mensagens associados serão removidos permanentemente. Esta
              ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {mutationError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
              {mutationError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={isPending}
              className="border-border hover:bg-muted flex-1 rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleDeleteConfirm}
              disabled={isPending}
              className="flex-1 rounded-xl bg-rose-500 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-60"
            >
              {isPending ? 'Excluindo…' : 'Excluir'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[16px]">Renomear revisão</DialogTitle>
            <DialogDescription className="text-[13px]">
              O título ajuda a identificar rapidamente o tema da revisão.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameConfirm();
              if (e.key === 'Escape') setRenameTarget(null);
            }}
            placeholder="Título da revisão…"
            maxLength={200}
            className="border-border bg-background focus:border-primary/60 focus:ring-primary/20 w-full rounded-xl border px-4 py-2.5 text-[14px] transition-all outline-none focus:ring-2"
          />
          {mutationError && <p className="text-[12px] text-rose-500">{mutationError}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setRenameTarget(null)}
              disabled={isPending}
              className="border-border hover:bg-muted flex-1 rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleRenameConfirm}
              disabled={isPending || !renameValue.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share */}
      {shareSessionId && (
        <ShareDialog
          chatId={shareSessionId}
          open={!!shareSessionId}
          onOpenChange={(open) => {
            if (!open) setShareSessionId(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CardMenu — DropdownMenu por card
// ---------------------------------------------------------------------------

interface CardMenuProps {
  row: HistoryRowSerialized;
  onDelete: () => void;
  onRename: () => void;
  onShare: () => void;
}

function CardMenu({ row, onDelete, onRename, onShare }: CardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground/40 hover:text-foreground hover:bg-muted -mr-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          aria-label="Mais opções"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        {/* Continuar / Ver sessão */}
        {row.chatId && (
          <DropdownMenuItem asChild>
            <a href={`/workspace/chat/${row.chatId}`} className="flex items-center gap-2">
              <ArrowRight className="h-3.5 w-3.5 opacity-50" />
              {row.articleCount > 0 ? 'Continuar revisão' : 'Abrir sessão'}
            </a>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onRename} className="flex items-center gap-2">
          <Pencil className="h-3.5 w-3.5 opacity-50" />
          Renomear
        </DropdownMenuItem>

        {row.chatId && (
          <DropdownMenuItem onClick={onShare} className="flex items-center gap-2">
            <Share2 className="h-3.5 w-3.5 opacity-50" />
            Compartilhar…
          </DropdownMenuItem>
        )}

        {/* Exports */}
        {row.chatId && row.articleCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a
                href={`/api/export?chat_id=${row.chatId}&format=bibtex`}
                download
                className="flex items-center gap-2"
              >
                <Download className="h-3.5 w-3.5 opacity-50" />
                Exportar BibTeX
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={`/api/export?chat_id=${row.chatId}&format=ris`}
                download
                className="flex items-center gap-2"
              >
                <Download className="h-3.5 w-3.5 opacity-50" />
                Exportar RIS
                <span className="text-muted-foreground/50 ml-auto text-[10px]">
                  EndNote/Mendeley
                </span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={`/api/export?chat_id=${row.chatId}&format=csv`}
                download
                className="flex items-center gap-2"
              >
                <SquareStack className="h-3.5 w-3.5 opacity-50" />
                Exportar CSV
                <span className="text-muted-foreground/50 ml-auto text-[10px]">planilha</span>
              </a>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onDelete}
          className="flex items-center gap-2 text-rose-500 focus:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir revisão
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

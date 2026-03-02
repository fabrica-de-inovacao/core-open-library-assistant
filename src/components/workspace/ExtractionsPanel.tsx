'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Database,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  FileText,
  LinkIcon,
  MoreVertical,
  Flame,
  Clock,
  RefreshCw,
  BrainCircuit,
  CheckCircle2,
  AlertCircle,
  TriangleAlert,
} from 'lucide-react';
import type { RealtimeStatus } from '@/hooks/useSupabaseRealtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Article {
  id: string;
  title?: string | null;
  authors?: string | null;
  publicationYear?: number | null;
  sourceName?: string | null;
  doi?: string | null;
  citationCount?: number | null;
  keywords?: string | null;
  abstract?: string | null;
  tldrContent?: string | null;
  originalUrl?: string | null;
  status?: string | null;
  publisher?: string | null;
}

interface ExtractionsPanelProps {
  articles: Article[];
  activeQueryId: string | null;
  /** G-03: highlightedRow usa UUID (string) em vez de número de linha */
  highlightedRow: string | null;
  hasZeroResults: boolean;
  isSearchRunning: boolean;
  realtimeStatus: RealtimeStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAGE_SIZE = 20;

const STATUS_CONFIG: Record<
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
  processing: {
    label: 'Processando',
    Icon: RefreshCw,
    classes:
      'border-primary/30 bg-primary/5 text-primary dark:border-primary/30 dark:bg-primary/10',
    ping: true,
  },
  llm_processing: {
    label: 'Gerando síntese',
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

const TERMINAL_STATUSES = ['done', 'abstract_only', 'failed'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function exportCsv(selectedArticles: Article[]) {
  const headers = ['Title', 'Authors', 'Year', 'DOI', 'Keywords', 'CitationCount', 'Abstract'];
  const csvContent =
    headers.join(',') +
    '\n' +
    selectedArticles
      .map((a) =>
        [
          `"${(a.title || '').replace(/"/g, '""')}"`,
          `"${(a.authors || '').replace(/"/g, '""')}"`,
          a.publicationYear || '',
          a.doi || '',
          `"${(a.keywords || '').replace(/"/g, '""')}"`,
          a.citationCount || '',
          `"${(a.abstract || '').replace(/"/g, '""')}"`,
        ].join(',')
      )
      .join('\n');

  downloadBlob(csvContent, 'text/csv;charset=utf-8;', `export_${dateStr()}.csv`);
}

function exportBibtex(selectedArticles: Article[]) {
  const bibtexContent = selectedArticles
    .map((a) => {
      const authorFormat = a.authors ? a.authors.split(', ').join(' and ') : 'Unknown';
      return (
        `@article{${a.doi ? a.doi.replace(/\//g, '_') : 'auth' + (a.publicationYear || '')},\n` +
        `  title={${a.title}},\n` +
        `  author={${authorFormat}},\n` +
        `  year={${a.publicationYear || 'unknown'}},\n` +
        `  url={${a.originalUrl}}` +
        `${a.doi ? `,\n  doi={${a.doi}}` : ''}` +
        `${a.publisher ? `,\n  publisher={${a.publisher}}` : ''}\n}`
      );
    })
    .join('\n\n');

  downloadBlob(bibtexContent, 'text/plain;charset=utf-8;', `references_${dateStr()}.bib`);
}

function downloadBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function dateStr() {
  return new Date().toISOString().split('T')[0];
}

async function copyToClipboard(text: string, description: string) {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`Copiado: ${description}`);
  } catch (err) {
    console.error('Falha ao copiar', err);
  }
}

// ---------------------------------------------------------------------------
// ExtractionsPanel
// ---------------------------------------------------------------------------
export const ExtractionsPanel = React.memo(
  ({
    articles,
    activeQueryId,
    highlightedRow,
    hasZeroResults,
    isSearchRunning,
    realtimeStatus,
  }: ExtractionsPanelProps) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

    // Reset pagination when activeQueryId changes
    useEffect(() => {
      const t = setTimeout(() => {
        setCurrentPage(1);
        setExpandedRows(new Set());
        setSelectedRows(new Set());
      }, 0);
      return () => clearTimeout(t);
    }, [activeQueryId]);

    const totalPages = Math.ceil(articles.length / PAGE_SIZE);
    const paginatedArticles = articles.slice(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE
    );

    const toggleRowExpansion = (id: string) => {
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const toggleRowSelection = (id: string, checked: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    };

    const toggleAllSelection = (checked: boolean) => {
      setSelectedRows(checked ? new Set(articles.map((a) => a.id)) : new Set());
    };

    const exportSelected = (format: 'csv' | 'bibtex') => {
      const selectedArticles = articles.filter((a) => selectedRows.has(a.id));
      if (selectedArticles.length === 0) return;
      if (format === 'csv') exportCsv(selectedArticles);
      else exportBibtex(selectedArticles);
    };

    const isAllSelected = articles.length > 0 && selectedRows.size === articles.length;
    const isIndeterminate = selectedRows.size > 0 && selectedRows.size < articles.length;

    const doneCount = articles.filter((a) => TERMINAL_STATUSES.includes(a.status || '')).length;
    const progressValue = articles.length > 0 ? (doneCount / articles.length) * 100 : 0;

    return (
      <div className="bg-muted/10 flex h-full flex-col">
        <div className="flex-1 overflow-auto p-6">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Database className="text-primary h-5 w-5" /> Acervo de Extração
                {articles.length > 0 && (
                  <span className="bg-primary/10 text-primary ml-1 rounded-full px-2 py-0.5 font-mono text-xs font-medium">
                    {articles.length}
                  </span>
                )}
              </h2>
              <p className="text-muted-foreground text-sm">
                Processamento assíncrono e extração de metadados em tempo real.
              </p>
              {/* E-04: badge de status da conexão Realtime */}
              {realtimeStatus === 'disconnected' && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                  <TriangleAlert className="h-3 w-3" /> Tempo Real desconectado — dados podem estar
                  desatualizados
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {totalPages > 1 && (
                <div className="border-border bg-card flex items-center gap-1 rounded-lg border p-1 shadow-sm">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 font-mono text-xs font-bold whitespace-nowrap">
                    Página {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {selectedRows.size > 0 && (
                <div className="animate-in fade-in zoom-in flex items-center gap-2 duration-200">
                  <span className="text-muted-foreground text-sm font-medium">
                    {selectedRows.size} selecionado(s)
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2 border-dashed">
                        <Download className="h-3.5 w-3.5" />
                        Exportar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Formato de Exportação</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => exportSelected('csv')}>
                        Tabela CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportSelected('bibtex')}>
                        Citações BibTeX
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>

          {activeQueryId ? (
            <div className="flex flex-col gap-4">
              {/* Progress Bar */}
              {articles.length > 0 && (
                <div className="border-border bg-card/50 flex items-center gap-4 rounded-xl border px-4 py-3">
                  <div className="flex-1">
                    <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-medium">
                      <span>Progresso da Extração</span>
                      <span className="text-primary font-mono text-xs">
                        {doneCount} / {articles.length} concluídos
                      </span>
                    </div>
                    <Progress value={progressValue} className="bg-muted h-1.5" />
                  </div>
                </div>
              )}

              <div className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="border-border bg-muted/50 text-muted-foreground sticky top-0 z-10 border-b font-mono text-xs backdrop-blur">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-center font-medium">
                        <Checkbox
                          checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                          onCheckedChange={(checked) => toggleAllSelection(!!checked)}
                          aria-label="Select all"
                          className="translate-y-[2px]"
                        />
                      </th>
                      <th className="w-10 px-2 py-2.5 text-center font-medium">#</th>
                      <th className="px-3 py-2.5 font-medium">Metadados do Artigo</th>
                      <th className="w-24 px-3 py-2.5 font-medium">Status</th>
                      <th className="w-10 px-3 py-2.5 text-center font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {paginatedArticles.map((article, idx) => {
                      const absoluteIndex = (currentPage - 1) * PAGE_SIZE + idx;
                      const rowNumber = absoluteIndex + 1;
                      const isExpanded = expandedRows.has(article.id);
                      const isSelected = selectedRows.has(article.id);

                      const displayContent = article.tldrContent || article.abstract;
                      const contentSource = article.tldrContent ? 'TL;DR IA' : 'ABSTRACT';

                      return (
                        <tr
                          key={article.id}
                          id={`article-row-${article.id}`}
                          className={`group transition-colors ${isSelected ? 'bg-primary/5 dark:bg-primary/10' : 'hover:bg-muted/30'} ${highlightedRow === article.id ? 'bg-primary/10 ring-primary ring-2 ring-inset' : ''}`}
                        >
                          <td className="px-3 py-4 text-center align-top">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                toggleRowSelection(article.id, !!checked)
                              }
                              className="translate-y-[2px]"
                            />
                          </td>
                          <td
                            className={`px-2 py-4 text-center align-top font-mono text-xs transition-colors ${highlightedRow === article.id ? 'text-primary font-bold' : 'text-muted-foreground'}`}
                          >
                            {rowNumber.toString().padStart(2, '0')}
                          </td>
                          <td className="max-w-xl px-3 py-4 align-top">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <a
                                  href={article.originalUrl ?? '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-foreground hover:text-primary hover:decoration-primary/30 mb-1.5 line-clamp-2 text-sm leading-tight font-semibold hover:underline"
                                  title={article.title ?? ''}
                                >
                                  {article.title}
                                </a>

                                <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                  <span
                                    className="max-w-[200px] truncate font-medium"
                                    title={article.authors || ''}
                                  >
                                    {article.authors?.split(',')[0]}{' '}
                                    {article.authors?.includes(',') && 'et al.'}
                                  </span>
                                  <span>•</span>
                                  <span className="font-mono">{article.publicationYear}</span>
                                  <span>•</span>
                                  <span
                                    className="max-w-[150px] truncate"
                                    title={article.sourceName || ''}
                                  >
                                    {article.sourceName}
                                  </span>

                                  {article.citationCount != null && article.citationCount > 0 && (
                                    <>
                                      <span>•</span>
                                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-500">
                                        <Flame className="h-3 w-3" />
                                        {article.citationCount}{' '}
                                        {article.citationCount === 1 ? 'citação' : 'citações'}
                                      </span>
                                    </>
                                  )}

                                  {article.doi && (
                                    <>
                                      <span>•</span>
                                      <a
                                        href={`https://doi.org/${article.doi}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-primary inline-flex items-center gap-1 transition-colors"
                                      >
                                        <LinkIcon className="h-3 w-3" />
                                        <span className="font-mono hover:underline">DOI</span>
                                      </a>
                                    </>
                                  )}
                                </div>

                                {article.keywords && (
                                  <div
                                    className={`mb-3 flex flex-wrap gap-1 ${!isExpanded ? 'max-h-6 overflow-hidden' : ''}`}
                                  >
                                    {article.keywords.split(',').map((kw: string, i: number) => (
                                      <span
                                        key={i}
                                        className="bg-muted text-muted-foreground inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                                      >
                                        {kw.trim()}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {displayContent && (
                                  <div className="border-border bg-muted/20 group/content relative rounded-md border p-3">
                                    <div className="mb-1 flex items-center justify-between">
                                      <div
                                        className={`font-mono text-[10px] font-semibold tracking-wider uppercase ${contentSource === 'TL;DR IA' ? 'text-primary' : 'text-slate-500'}`}
                                      >
                                        {contentSource}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full opacity-0 transition-opacity group-hover/content:opacity-100"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyToClipboard(displayContent, contentSource);
                                        }}
                                        title="Copiar texto"
                                      >
                                        <Copy className="text-muted-foreground h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div
                                      className={`text-foreground/90 font-sans text-xs leading-relaxed ${!isExpanded ? 'line-clamp-2' : ''}`}
                                    >
                                      {displayContent}
                                    </div>
                                    <button
                                      onClick={() => toggleRowExpansion(article.id)}
                                      className="text-primary hover:text-primary/80 mt-1 flex items-center gap-0.5 text-[10px] font-medium transition-colors"
                                    >
                                      {isExpanded ? (
                                        <>
                                          <ChevronUp className="h-3 w-3" /> Mostrar menos
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="h-3 w-3" /> Ler completo
                                        </>
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="px-3 py-4 align-top">
                            {(() => {
                              const config = STATUS_CONFIG[article.status ?? ''];
                              if (!config)
                                return (
                                  <span className="text-muted-foreground font-mono text-[10px]">
                                    {article.status ?? '—'}
                                  </span>
                                );
                              const { label, Icon, classes, ping } = config;
                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${classes}`}
                                >
                                  {ping && (
                                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                                    </span>
                                  )}
                                  <Icon className="h-2.5 w-2.5 shrink-0" />
                                  {label}
                                </span>
                              );
                            })()}
                          </td>

                          {/* Actions dropdown */}
                          <td className="px-3 py-4 text-right align-top">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={() =>
                                    copyToClipboard(article.originalUrl ?? '', 'Link Original')
                                  }
                                >
                                  <LinkIcon className="text-muted-foreground mr-2 h-4 w-4" />
                                  <span>Copiar Link</span>
                                </DropdownMenuItem>
                                {article.doi && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      copyToClipboard(`https://doi.org/${article.doi}`, 'Link DOI')
                                    }
                                  >
                                    <LinkIcon className="text-primary mr-2 h-4 w-4" />
                                    <span>Copiar DOI</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => copyToClipboard(article.title || '', 'Título')}
                                >
                                  <Copy className="text-muted-foreground mr-2 h-4 w-4" />
                                  <span>Copiar Título</span>
                                </DropdownMenuItem>
                                {displayContent && (
                                  <DropdownMenuItem
                                    onClick={() => copyToClipboard(displayContent, contentSource)}
                                  >
                                    <FileText className="text-muted-foreground mr-2 h-4 w-4" />
                                    <span>Copiar {contentSource}</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-muted-foreground font-mono text-xs">
                                  CITAÇÃO
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => {
                                    const year = article.publicationYear
                                      ? ` (${article.publicationYear})`
                                      : '';
                                    copyToClipboard(
                                      `${article.authors || 'Unknown'}.${year}. ${article.title}. ${article.sourceName || ''}.`,
                                      'Citação (APA)'
                                    );
                                  }}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  <span>Formato APA</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    let abntAuthors = 'Unknown';
                                    if (article.authors) {
                                      abntAuthors = article.authors
                                        .split(', ')
                                        .map((author: string) => {
                                          const parts = author.split(' ');
                                          if (parts.length > 1) {
                                            return `${parts.pop()?.toUpperCase()}, ${parts.join(' ')}`;
                                          }
                                          return author.toUpperCase();
                                        })
                                        .join('; ');
                                    }
                                    copyToClipboard(
                                      `${abntAuthors}. ${article.title}. ${article.sourceName || ''}, ${article.publicationYear || ''}.`,
                                      'Citação (ABNT)'
                                    );
                                  }}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  <span>Formato ABNT</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Empty states */}
                {articles.length === 0 && !hasZeroResults && (
                  <div className="p-8">
                    <div className="space-y-4">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                          <Skeleton className="h-4 w-6 rounded" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-3/4 rounded" />
                            <Skeleton className="h-3 w-1/3 rounded opacity-50" />
                          </div>
                          <Skeleton className="h-5 w-20 rounded" />
                        </div>
                      ))}
                    </div>
                    <div className="text-muted-foreground mt-8 animate-pulse text-center font-mono text-xs">
                      Aguardando indexação dos primeiros artigos...
                    </div>
                  </div>
                )}

                {hasZeroResults && (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="bg-destructive/10 text-destructive mb-4 rounded-full p-4">
                      <Search className="h-8 w-8" />
                    </div>
                    <h3 className="text-foreground mb-2 text-lg font-semibold tracking-tight">
                      Busca sem resultados
                    </h3>
                    <p className="text-muted-foreground max-w-sm text-sm">
                      Nenhum artigo encontrado na base SBC OpenLib para esta pesquisa. Tente
                      reformular os termos ou faça uma busca global no OpenAlex.
                    </p>
                    <p className="text-muted-foreground border-primary/20 bg-primary/5 dark:border-primary/30 dark:bg-primary/10 mt-4 max-w-xs rounded-lg border border-dashed p-3 text-xs">
                      💡 <strong>Dica:</strong> Pergunte ao assistente à esquerda para fazer uma{' '}
                      <span className="text-primary dark:text-primary/80">
                        busca global no OpenAlex
                      </span>{' '}
                      com os mesmos termos.
                    </p>
                  </div>
                )}
              </div>

              {/* Bottom pagination */}
              {totalPages > 1 && (
                <div className="mt-2 flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="h-8 rounded-full px-4"
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" /> Anterior
                  </Button>
                  <span className="text-muted-foreground text-xs font-medium">
                    Página {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="h-8 rounded-full px-4"
                  >
                    Próximo <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ) : isSearchRunning ? (
            /* Search running empty state */
            <div className="border-border bg-muted/10 flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
              <div className="bg-primary/10 ring-primary/30 mb-4 flex items-center justify-center rounded-full p-4 ring-1">
                <Loader2 className="text-primary h-8 w-8 animate-spin" />
              </div>
              <h3 className="text-foreground/80 mb-2 font-medium tracking-tight">
                Pesquisando e inicializando extração...
              </h3>
              <p className="text-muted-foreground w-full max-w-sm text-sm">
                Aguarde enquanto a inteligência artificial consulta a base de dados da SBC OpenLib e
                organiza os resultados.
              </p>
              <div className="mt-8 w-full max-w-xs space-y-3 opacity-60">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-5/6 rounded" />
                <Skeleton className="h-4 w-4/6 rounded" />
              </div>
            </div>
          ) : (
            /* No active query */
            <div className="border-border bg-muted/10 flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed text-center">
              <div className="bg-muted/50 ring-border/50 mb-4 flex items-center justify-center rounded-full p-4 ring-1">
                <Database className="text-muted-foreground h-8 w-8" />
              </div>
              <h3 className="text-foreground/80 mb-1 font-medium tracking-tight">
                Nenhum acervo ativo
              </h3>
              <p className="text-muted-foreground max-w-xs font-sans text-sm">
                Inicie uma pesquisa no painel ao lado para começar a extração e análise de artigos.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
);
ExtractionsPanel.displayName = 'ExtractionsPanel';

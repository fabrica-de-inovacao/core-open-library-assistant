'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
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
  Download,
  CheckCircle2,
  Clock,
  TriangleAlert,
  PanelRightClose,
  StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import type { ExtractionsPanelProps } from './extractions/types';
import { PAGE_SIZE, TERMINAL_STATUSES } from './extractions/config';
import { exportCsv, exportBibtex } from './extractions/helpers';
import { ArticleCard, ArticleCardSkeleton } from './extractions/ArticleCard';

export const ExtractionsPanel = React.memo(
  ({
    articles,
    activeQueryId,
    highlightedRow,
    hasZeroResults,
    isSearchRunning,
    realtimeStatus,
    onCollapse,
    onDeleteArticle,
    onCancelSearch,
    title,
    searchCount,
  }: ExtractionsPanelProps) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

    useEffect(() => {
      const t = setTimeout(() => {
        setCurrentPage(1);
        setSelectedRows(new Set());
      }, 0);
      return () => clearTimeout(t);
    }, [activeQueryId]);

    // BUG-04: filtra artigos com status terminal 'failed' para não poluir o painel
    const visibleArticles = articles.filter((a) => a.status !== 'failed');

    const totalPages = Math.ceil(visibleArticles.length / PAGE_SIZE);
    const paginatedArticles = visibleArticles.slice(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE
    );

    const toggleRowSelection = useCallback((id: string, checked: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
    }, []);

    const toggleAllSelection = (checked: boolean) => {
      setSelectedRows(checked ? new Set(articles.map((a) => a.id)) : new Set());
    };

    const exportSelected = (format: 'csv' | 'bibtex') => {
      const sel = articles.filter((a) => selectedRows.has(a.id));
      if (sel.length === 0) return;
      if (format === 'csv') exportCsv(sel);
      else exportBibtex(sel);
    };

    const isAllSelected = articles.length > 0 && selectedRows.size === articles.length;
    const isIndeterminate = selectedRows.size > 0 && selectedRows.size < articles.length;

    const doneCount = articles.filter((a) =>
      TERMINAL_STATUSES.includes(a.status as (typeof TERMINAL_STATUSES)[number])
    ).length;
    const processingCount = articles.filter(
      (a) => a.status && !TERMINAL_STATUSES.includes(a.status as (typeof TERMINAL_STATUSES)[number])
    ).length;
    const progressValue = articles.length > 0 ? (doneCount / articles.length) * 100 : 0;
    const isProcessingComplete = articles.length > 0 && doneCount >= articles.length;

    return (
      <div className="bg-background flex h-full min-h-0 min-w-0 flex-col">
        {/* Header */}
        <div className="border-border flex shrink-0 flex-col border-b">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Database className="text-primary size-4 shrink-0" />
              <h2 className="text-foreground text-sm font-semibold tracking-tight">
                {title ?? 'Acervo de Extração'}
              </h2>
              {articles.length > 0 && (
                <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 font-mono text-xs font-bold">
                  {articles.length}
                </span>
              )}
              {searchCount ? (
                <span className="text-muted-foreground text-xs">{searchCount} buscas</span>
              ) : null}
              {realtimeStatus === 'disconnected' && (
                <span
                  className="flex items-center gap-0.5 text-xs text-amber-500"
                  title="Realtime desconectado — dados podem estar desatualizados"
                >
                  <TriangleAlert className="size-3" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {totalPages > 1 && (
                <div className="border-border flex items-center gap-0.5 rounded-lg border px-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="px-1 font-mono text-[10px] font-bold whitespace-nowrap">
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}

              {selectedRows.size > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                      <Download className="size-3.5" />
                      {selectedRows.size}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel>Exportar seleção</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => exportSelected('csv')}>
                      Tabela CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportSelected('bibtex')}>
                      Citações BibTeX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {(isSearchRunning || processingCount > 0) &&
                !isProcessingComplete &&
                activeQueryId &&
                onCancelSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive h-7 gap-1.5 text-xs"
                    onClick={() => void onCancelSearch(activeQueryId)}
                    title="Parar extração"
                  >
                    <StopCircle className="size-3.5" />
                    Parar
                  </Button>
                )}

              {onCollapse && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-8"
                  onClick={onCollapse}
                  title="Recolher painel"
                >
                  <PanelRightClose className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {articles.length > 0 && (
            <div className="px-4 pb-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {isProcessingComplete ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-emerald-500" /> Extração concluída
                    </>
                  ) : processingCount > 0 ? (
                    <>
                      <Loader2 className="text-primary size-3.5 animate-spin" /> Processando{' '}
                      {processingCount} artigo{processingCount !== 1 ? 's' : ''}…
                    </>
                  ) : (
                    <>
                      <Clock className="size-3.5" /> Aguardando processamento
                    </>
                  )}
                </span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    isProcessingComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary'
                  )}
                >
                  {doneCount} / {articles.length}
                </span>
              </div>
              <Progress
                value={progressValue}
                className={cn('h-1.5', isProcessingComplete && '[&>div]:bg-emerald-500')}
              />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeQueryId || articles.length > 0 ? (
            <>
              {articles.length > 0 && (
                <div className="border-border/60 bg-muted/10 flex items-center gap-2 border-b px-4 py-2">
                  <Checkbox
                    checked={isAllSelected || (isIndeterminate ? 'indeterminate' : false)}
                    onCheckedChange={(checked) => toggleAllSelection(!!checked)}
                    aria-label="Selecionar todos"
                  />
                  <span className="text-muted-foreground text-xs">
                    {isAllSelected
                      ? 'Todos selecionados'
                      : isIndeterminate
                        ? `${selectedRows.size} selecionados`
                        : `${articles.length} artigos`}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-3 p-4">
                {articles.length === 0 && !hasZeroResults && (
                  <>
                    {[0, 1, 2, 3].map((i) => (
                      <ArticleCardSkeleton key={i} index={i} />
                    ))}
                    <p className="text-muted-foreground animate-pulse py-2 text-center font-mono text-xs">
                      Indexando primeiros artigos…
                    </p>
                  </>
                )}

                {hasZeroResults && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="bg-destructive/10 text-destructive mb-4 rounded-full p-4">
                      <Search className="size-8" />
                    </div>
                    <h3 className="text-foreground mb-1 font-semibold tracking-tight">
                      Nenhum resultado encontrado
                    </h3>
                    <p className="text-muted-foreground max-w-sm text-sm">
                      Tente reformular os termos da busca ou use a busca global no OpenAlex.
                    </p>
                    <p className="text-muted-foreground border-primary/20 bg-primary/5 mt-4 max-w-xs rounded-lg border border-dashed p-3 text-xs">
                      💡 Pergunte ao assistente para fazer uma{' '}
                      <span className="text-primary font-medium">busca global no OpenAlex</span>.
                    </p>
                  </div>
                )}

                {paginatedArticles.map((article, idx) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    index={(currentPage - 1) * PAGE_SIZE + idx + 1}
                    isSelected={selectedRows.has(article.id)}
                    isHighlighted={highlightedRow === article.id}
                    onToggleSelect={toggleRowSelection}
                    onDeleteArticle={onDeleteArticle}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="border-border flex items-center justify-center gap-4 border-t px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="h-8 rounded-full px-4"
                  >
                    <ChevronLeft className="mr-1.5 size-3.5" /> Anterior
                  </Button>
                  <span className="text-muted-foreground text-xs font-medium">
                    {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="h-8 rounded-full px-4"
                  >
                    Próximo <ChevronRight className="ml-1.5 size-3.5" />
                  </Button>
                </div>
              )}
            </>
          ) : isSearchRunning ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="mb-1 flex items-center gap-2 px-1">
                <Loader2 className="text-primary size-4 animate-spin" />
                <span className="text-muted-foreground text-sm">
                  Pesquisando e inicializando extração…
                </span>
              </div>
              {[0, 1, 2, 3].map((i) => (
                <ArticleCardSkeleton key={i} index={i} />
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="bg-muted/60 ring-border/40 mb-4 rounded-full p-5 ring-1">
                <Database className="text-muted-foreground size-8" />
              </div>
              <h3 className="text-foreground/80 mb-1 font-semibold tracking-tight">
                Nenhum acervo ativo
              </h3>
              <p className="text-muted-foreground max-w-[240px] text-sm">
                Inicie uma pesquisa no painel ao lado para extrair e analisar artigos.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ExtractionsPanel.displayName = 'ExtractionsPanel';

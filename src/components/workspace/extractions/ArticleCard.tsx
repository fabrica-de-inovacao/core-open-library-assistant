'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  ExternalLink,
  MoreVertical,
  Flame,
  Microscope,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArticleCardProps } from './types';
import { STATUS_CONFIG } from './config';
import { copyToClipboard, buildCitationApa, buildCitationAbnt } from './helpers';
import { CitationGraphPanel, type CitationGraphData } from '@/components/CitationGraphPanel';

// ---------------------------------------------------------------------------
// ArticleCard
// ---------------------------------------------------------------------------
export function ArticleCard({
  article,
  index,
  isSelected,
  isHighlighted,
  onToggleSelect,
  onDeleteArticle,
}: ArticleCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Artigos enviados pelo utilizador (URL sintética) podem ser removidos
  const isDeletable = article.originalUrl?.startsWith('user:') && !!onDeleteArticle;

  const handleDelete = useCallback(async () => {
    if (!onDeleteArticle) return;
    setIsDeleting(true);
    try {
      await onDeleteArticle(article.id);
    } finally {
      setIsDeleting(false);
    }
  }, [article.id, onDeleteArticle]);

  const displayContent = article.tldrContent || article.abstract;
  const hasTldr = !!article.tldrContent;

  const firstAuthor = article.authors?.split(',')[0]?.trim() ?? null;
  const hasMultipleAuthors = (article.authors?.split(',').length ?? 0) > 1;

  const keywords = article.keywords
    ? article.keywords
        .split(',')
        .map((k: string) => k.trim())
        .filter(Boolean)
    : [];
  const visibleKeywords = isExpanded ? keywords : keywords.slice(0, 4);
  const hiddenKeywordsCount = keywords.length - 4;

  const config = STATUS_CONFIG[article.status ?? ''];

  const handleCitationApa = useCallback(() => {
    copyToClipboard(buildCitationApa(article), 'Citação APA copiada');
  }, [article]);

  const handleCitationAbnt = useCallback(() => {
    copyToClipboard(buildCitationAbnt(article), 'Citação ABNT copiada');
  }, [article]);

  return (
    <div
      id={`article-row-${article.id}`}
      className={cn(
        'bg-card relative rounded-xl border p-4 shadow-sm transition-all duration-200',
        isSelected
          ? 'border-primary/40 bg-primary/[0.03] shadow-primary/10 shadow-md'
          : 'border-border hover:border-primary/20 hover:shadow-md',
        isHighlighted && 'ring-primary border-primary/40 ring-2 ring-offset-1'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox + index */}
        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelect(article.id, !!checked)}
            aria-label={`Selecionar artigo ${index}`}
          />
          <span
            className={cn(
              'font-mono text-[10px] font-bold tabular-nums',
              isHighlighted ? 'text-primary' : 'text-muted-foreground/50'
            )}
          >
            {String(index).padStart(2, '0')}
          </span>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Title row + status badge + action menu */}
          <div className="mb-1.5 flex items-start gap-2">
            {/* Fase 3 (P-PDF): URLs sintéticas (user:upload / user:doi) não são links reais */}
            {article.originalUrl?.startsWith('user:') ? (
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm leading-snug font-semibold',
                  !isExpanded && 'line-clamp-2'
                )}
                title={article.title ?? ''}
              >
                {article.title}
              </span>
            ) : (
              <a
                href={article.originalUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'hover:text-primary decoration-primary/30 min-w-0 flex-1 text-sm leading-snug font-semibold transition-colors hover:underline',
                  !isExpanded && 'line-clamp-2'
                )}
                title={article.title ?? ''}
              >
                {article.title}
                <ExternalLink className="ml-1 inline size-3 shrink-0 opacity-40" />
              </a>
            )}

            <div className="flex shrink-0 items-center gap-1">
              {/* Fase 3: badges para documentos do próprio usuário */}
              {article.metadataSource === 'user_upload' && (
                <span className="inline-flex items-center rounded border border-violet-300/60 bg-violet-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-violet-600 uppercase dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-400">
                  Meu doc.
                </span>
              )}
              {article.metadataSource === 'user_doi' && (
                <span className="inline-flex items-center rounded border border-blue-300/60 bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-blue-600 uppercase dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-400">
                  Via DOI
                </span>
              )}

              {/* Status badge */}
              {config ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider uppercase',
                    config.classes
                  )}
                >
                  {config.ping && (
                    <span className="relative flex size-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                    </span>
                  )}
                  <config.Icon className="size-2.5 shrink-0" />
                  {config.label}
                </span>
              ) : (
                <span className="text-muted-foreground font-mono text-[9px]">
                  {article.status ?? '—'}
                </span>
              )}

              {/* Actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted size-6 shrink-0"
                    title="Ações do artigo"
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => copyToClipboard(article.originalUrl ?? '', 'Link copiado')}
                  >
                    <ExternalLink className="text-muted-foreground mr-2 size-3.5" /> Copiar link
                  </DropdownMenuItem>
                  {article.doi && (
                    <DropdownMenuItem
                      onClick={() =>
                        copyToClipboard(`https://doi.org/${article.doi}`, 'DOI copiado')
                      }
                    >
                      <ExternalLink className="text-primary mr-2 size-3.5" /> Copiar DOI
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => copyToClipboard(article.title ?? '', 'Título copiado')}
                  >
                    <Copy className="text-muted-foreground mr-2 size-3.5" /> Copiar título
                  </DropdownMenuItem>
                  {displayContent && (
                    <DropdownMenuItem
                      onClick={() =>
                        copyToClipboard(
                          displayContent,
                          hasTldr ? 'TL;DR copiado' : 'Abstract copiado'
                        )
                      }
                    >
                      <FileText className="text-muted-foreground mr-2 size-3.5" /> Copiar{' '}
                      {hasTldr ? 'TL;DR' : 'Abstract'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-muted-foreground font-mono text-[10px] uppercase">
                    Citação
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleCitationApa}>
                    <Copy className="mr-2 size-3.5" /> Formato APA
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCitationAbnt}>
                    <Copy className="mr-2 size-3.5" /> Formato ABNT
                  </DropdownMenuItem>
                  {isDeletable && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="mr-2 size-3.5" />
                        {isDeleting ? 'Removendo…' : 'Remover do acervo'}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Metadata strip */}
          <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {firstAuthor && (
              <span className="max-w-[200px] truncate font-medium" title={article.authors ?? ''}>
                {firstAuthor}
                {hasMultipleAuthors && ' et al.'}
              </span>
            )}
            {article.publicationYear && (
              <>
                <span className="text-border">·</span>
                <span className="font-mono">{article.publicationYear}</span>
              </>
            )}
            {article.sourceName && (
              <>
                <span className="text-border">·</span>
                <span className="max-w-[160px] truncate italic" title={article.sourceName}>
                  {article.sourceName}
                </span>
              </>
            )}
            {article.doi && (
              <>
                <span className="text-border">·</span>
                <a
                  href={`https://doi.org/${article.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary inline-flex items-center gap-0.5 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="font-mono hover:underline">DOI</span>
                  <ExternalLink className="size-2.5" />
                </a>
              </>
            )}
            {article.citationCount != null && article.citationCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                  <Flame className="size-2.5 shrink-0" />
                  {article.citationCount}
                </span>
              </>
            )}
            {article.isOpenAccess && (
              <Badge
                variant="outline"
                className="h-4 border-emerald-300 px-1.5 py-0 text-[9px] font-semibold text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
              >
                Open Access
              </Badge>
            )}
          </div>

          {/* Keywords */}
          {keywords.length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1">
              {visibleKeywords.map((kw: string, i: number) => (
                <span
                  key={i}
                  className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
                >
                  {kw}
                </span>
              ))}
              {!isExpanded && hiddenKeywordsCount > 0 && (
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-primary text-[10px] font-medium hover:underline"
                >
                  +{hiddenKeywordsCount}
                </button>
              )}
            </div>
          )}

          {/* TL;DR / Abstract block */}
          {displayContent && (
            <div className="border-border bg-muted/20 relative rounded-lg border px-3 pt-2.5 pb-2">
              <div className="mb-1 flex items-center justify-between">
                {hasTldr ? (
                  <span className="text-primary flex items-center gap-1 font-mono text-[10px] font-bold tracking-wider uppercase">
                    <Microscope className="size-3" /> TL;DR IA
                  </span>
                ) : (
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                    Abstract
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 size-5 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(displayContent, hasTldr ? 'TL;DR copiado' : 'Abstract copiado');
                  }}
                  title="Copiar"
                >
                  <Copy className="text-muted-foreground size-3" />
                </Button>
              </div>
              <p
                className={cn(
                  'text-foreground/85 font-sans text-xs leading-relaxed',
                  !isExpanded && 'line-clamp-3'
                )}
              >
                {displayContent}
              </p>
              <button
                onClick={() => setIsExpanded((v) => !v)}
                className="text-primary hover:text-primary/80 mt-1.5 flex items-center gap-0.5 text-[10px] font-medium transition-colors"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="size-3" /> Mostrar menos
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3" /> Ler completo
                  </>
                )}
              </button>
            </div>
          )}

          {/* Fase 6 (P-seguinte): Painel de Papers Relacionados (Grafo de Citações) */}
          {article.citationGraph != null && (
            <CitationGraphPanel
              articleTitle={article.title ?? undefined}
              citationGraph={article.citationGraph as CitationGraphData}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArticleCardSkeleton
// ---------------------------------------------------------------------------
export function ArticleCardSkeleton({ index }: { index: number }) {
  return (
    <div className="border-border bg-card rounded-xl border p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-2.5 w-4 rounded" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 rounded" style={{ width: `${72 + ((index * 7) % 22)}%` }} />
              <Skeleton className="h-4 rounded" style={{ width: `${42 + ((index * 11) % 26)}%` }} />
            </div>
            <Skeleton className="h-5 w-20 shrink-0 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-3 w-8 rounded" />
            <Skeleton className="h-3 w-28 rounded" />
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map((k) => (
              <Skeleton key={k} className="h-4 w-14 rounded-sm" />
            ))}
          </div>
          <div className="border-border bg-muted/20 space-y-1.5 rounded-lg border px-3 py-2.5">
            <Skeleton className="h-2.5 w-14 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 rounded" style={{ width: '86%' }} />
            <Skeleton className="h-3 rounded" style={{ width: '68%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

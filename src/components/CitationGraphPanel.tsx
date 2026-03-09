'use client';

/**
 * components/CitationGraphPanel.tsx
 * Fase 6 (P-seguinte): Painel de Papers Relacionados via grafo de citações.
 *
 * Exibe referências (artigos citados pelo artigo) e citações (artigos que
 * citaram este artigo), recuperadas da Semantic Scholar API via Inngest STEP 2.5.
 *
 * Uso:
 *   <CitationGraphPanel
 *     articleTitle="Attention Is All You Need"
 *     citationGraph={article.citationGraph}
 *   />
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, BookOpen, Quote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface CitationGraphEntry {
  title: string | null;
  doi: string | null;
}

export interface CitationGraphData {
  references: CitationGraphEntry[]; // artigos que ESTE artigo cita (backward)
  citations: CitationGraphEntry[]; // artigos que citaram ESTE artigo (forward)
  fetched_at: string;
}

interface CitationGraphPanelProps {
  articleTitle?: string;
  citationGraph: CitationGraphData | null | undefined;
  /** Quando true, o painel inicia expandido */
  defaultExpanded?: boolean;
}

// ── Sub-componente: lista de papers ──────────────────────────────────────────

function PaperList({ papers, emptyLabel }: { papers: CitationGraphEntry[]; emptyLabel: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? papers : papers.slice(0, 5);

  if (papers.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm italic">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-1">
      {visible.map((p, i) => {
        const doiUrl = p.doi ? `https://doi.org/${p.doi}` : null;
        return (
          <div
            key={i}
            className="hover:bg-muted/50 group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors"
          >
            <span className="text-muted-foreground mt-0.5 min-w-[1.5rem] text-right text-xs select-none">
              {i + 1}.
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground line-clamp-2 text-sm leading-snug">
                {p.title ?? (
                  <span className="text-muted-foreground italic">Título indisponível</span>
                )}
              </p>
              {p.doi && (
                <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{p.doi}</p>
              )}
            </div>
            {doiUrl && (
              <a
                href={doiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                title="Abrir DOI externo"
              >
                <ExternalLink className="text-muted-foreground hover:text-foreground h-3.5 w-3.5" />
              </a>
            )}
          </div>
        );
      })}
      {papers.length > 5 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground mt-1 h-7 w-full text-xs"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? (
            <>
              <ChevronUp className="mr-1 h-3.5 w-3.5" /> Mostrar menos
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3.5 w-3.5" /> Ver mais {papers.length - 5} papers
            </>
          )}
        </Button>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CitationGraphPanel({
  articleTitle,
  citationGraph,
  defaultExpanded = false,
}: CitationGraphPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Grafo ausente (artigo sem DOI ou STEP 2.5 ainda não executou)
  if (!citationGraph) {
    return null;
  }

  const { references, citations, fetched_at } = citationGraph;
  const total = references.length + citations.length;

  // Sem dados relevantes — não exibir painel vazio
  if (total === 0) return null;

  return (
    <div className="border-border bg-card mt-3 rounded-lg border">
      {/* Header — sempre visível */}
      <button
        className="hover:bg-muted/30 flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <BookOpen className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Papers Relacionados</span>
          <Badge variant="secondary" className="h-5 text-xs">
            {total}
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        )}
      </button>

      {/* Corpo expansível */}
      {expanded && (
        <div className="space-y-4 px-4 pb-4">
          {/* Citações — quem citou ESTE artigo (forward) */}
          {citations.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Quote className="text-muted-foreground h-3.5 w-3.5" />
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Citado por ({citations.length})
                </h4>
              </div>
              <PaperList
                papers={citations}
                emptyLabel="Nenhum artigo que cita este trabalho encontrado via Semantic Scholar."
              />
            </section>
          )}

          {citations.length > 0 && references.length > 0 && <Separator />}

          {/* Referências — o que ESTE artigo cita (backward) */}
          {references.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <BookOpen className="text-muted-foreground h-3.5 w-3.5" />
                <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Referências ({references.length})
                </h4>
              </div>
              <PaperList
                papers={references}
                emptyLabel="Nenhuma referência encontrada via Semantic Scholar."
              />
            </section>
          )}

          {/* Rodapé com fonte */}
          <p className="text-muted-foreground/60 pt-1 text-xs">
            Via{' '}
            <a
              href="https://www.semanticscholar.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground underline underline-offset-2"
            >
              Semantic Scholar
            </a>
            {fetched_at && (
              <>
                {' '}
                · coletado em{' '}
                {new Date(fetched_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from 'react';
import { type UIMessage, isToolOrDynamicToolUIPart, getToolOrDynamicToolName } from 'ai';
import {
  Library,
  Copy,
  Check,
  Loader2,
  Search,
  Globe,
  FileText,
  Cpu,
  ThumbsUp,
  ThumbsDown,
  Table,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { toast } from 'sonner';
import { SearchProposalCard, GlobalSearchProposalCard, SearchJourneyCard } from './proposals';
import { SimilarQueryBanner, type SimilarQueryInfo } from './SimilarQueryBanner';
import type { ExecuteSearchFn, SearchAttempt } from './proposals';
import { MermaidBlock, CodeBlock, AssetWrapper } from './AssetRenderers';

// ---------------------------------------------------------------------------
// TypingIndicator — ChatGPT style (sem bolha, avatar lateral)
// ---------------------------------------------------------------------------
export const TypingIndicator = () => (
  <div className="chat-message-enter flex items-start gap-3">
    <div className="bg-muted ring-border mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
      <Library className="text-primary h-3.5 w-3.5" />
    </div>
    <div className="flex flex-col gap-1 pt-0.5">
      <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase select-none">
        C.O.R.E. AI
      </span>
      <div className="flex items-center gap-1.5 py-1.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground/40 block h-2 w-2 rounded-full"
            style={{
              animation: `typing-dot 1.2s ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Tool‑status pill helpers
// ---------------------------------------------------------------------------
type PillVariant = 'loading' | 'success' | 'error';
interface ToolStatusConfig {
  label: string;
  icon: React.ReactNode;
  variant: PillVariant;
}

const PILL_CLS: Record<PillVariant, string> = {
  loading:
    'border-sky-200/70 bg-sky-50/80 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300',
  success:
    'border-emerald-200/70 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  error:
    'border-rose-200/70 bg-rose-50/80 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300',
};

function getToolStatus(
  toolName: string,
  state: string,
  output?: Record<string, any>,
  /** true se o stream ainda está ativo (evita marcar done prematuramente) */
  isStreaming?: boolean,
  /** true se a mensagem mãe já tem texto — indica que a tool completou */
  hasMessageText?: boolean
): ToolStatusConfig | null {
  if (toolName === 'propose_search_sol_database' || toolName === 'propose_search_global_database') {
    if (state === 'output-available') return null;
    return {
      label: 'Elaborando estratégia de busca…',
      icon: <Cpu className="h-3 w-3 shrink-0" />,
      variant: 'loading',
    };
  }

  if (toolName === 'search_sol_database' || toolName === 'search_global_database') {
    const isGlobal = toolName === 'search_global_database';
    if (state !== 'output-available') {
      return {
        label: isGlobal ? 'Buscando global (OpenAlex)…' : 'Buscando base de dados…',
        icon: isGlobal ? (
          <Globe className="h-3 w-3 shrink-0" />
        ) : (
          <Search className="h-3 w-3 shrink-0" />
        ),
        variant: 'loading',
      };
    }
    if (output?.success === false || output?.total_found === 0) {
      return {
        label: 'Nenhum resultado encontrado.',
        icon: <Search className="h-3 w-3 shrink-0" />,
        variant: 'error',
      };
    }
    return {
      label: `${output?.total_found} artigos encontrados — extração iniciada.`,
      icon: <Search className="h-3 w-3 shrink-0" />,
      variant: 'success',
    };
  }

  if (toolName === 'generate_systematic_review') {
    // Considera concluída se: (a) SDK reportou output-available, OU
    // (b) output já existe no part (carregado do DB após reload), OU
    // (c) stream já terminou E a mensagem mãe tem texto (LLM respondeu após a tool).
    const isDone =
      state === 'output-available' || output !== undefined || (!isStreaming && hasMessageText);
    if (!isDone) {
      return {
        label: 'Gerando síntese sistemática…',
        icon: <FileText className="h-3 w-3 shrink-0" />,
        variant: 'loading',
      };
    }
    return {
      label: 'Revisão sistemática concluída.',
      icon: <FileText className="h-3 w-3 shrink-0" />,
      variant: 'success',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// ChatMessageItem
// ---------------------------------------------------------------------------
interface ChatMessageItemProps {
  m: UIMessage;
  /** G-03: highlightedRow usa UUID em vez de número de linha */
  setHighlightedRow: (value: string | null) => void;
  articles?: Array<{ id: string }>;
  isStreaming: boolean;
  userName?: string | null;
  onExecuteSearch?: ExecuteSearchFn;
  onCancelSearch?: (queryId: string) => void;
  executedProposalIds?: Set<string>;
  runningSearches?: Set<string>;
  /** Fase C (Batch 3): necessário para persistir o feedback da síntese */
  chatId?: string | null;
  /** Fase 3 (P-UI): jornada completa de busca — agrega proposals de todas as msgs da sessão */
  searchJourney?: SearchAttempt[];
}

export const ChatMessageItem = React.memo(
  ({
    m,
    setHighlightedRow,
    articles,
    isStreaming,
    userName,
    onExecuteSearch,
    onCancelSearch,
    executedProposalIds,
    runningSearches,
    chatId,
    searchJourney,
  }: ChatMessageItemProps) => {
    const [copied, setCopied] = useState(false);
    // Fase C (IA-05 / Batch 3): feedback pós-síntese — estado otimista local
    const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

    // Fase C (Batch 3): persiste feedback na API e atualiza estado otimista
    const handleFeedback = async (next: 'up' | 'down' | null) => {
      setFeedback(next);
      if (!chatId) return; // sem chatId, apenas feedback visual
      try {
        await fetch('/api/chat/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId, messageId: m.id, rating: next }),
        });
      } catch {
        // falha silenciosa — o feedback visual já foi aplicado
      }
    };

    const textContent =
      (m.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
        ?.text ?? '';

    // Síntese detectada pelo cabeçalho "# 📚 TL;DR" gerado pelo SynthesisAgent
    // (declarado após textContent para evitar TDZ)
    const SYNTHESIS_EMOJI = '\uD83D\uDCDA'; // 📚
    const isSynthesisMessage = textContent.includes(`# ${SYNTHESIS_EMOJI}`);

    // Texto visível: o smoothStream (backend) já envia palavra a palavra,
    // portanto renderizamos textContent diretamente — sem typewriter manual.
    const visibleText = textContent;

    const hasContent = textContent.trim().length > 0;
    type GenericToolInvocation = {
      toolCallId: string;
      toolName: string;
      state?: string;
      result?: unknown;
      output?: unknown;
      args?: unknown;
      input?: unknown;
    };

    const msgParsed = m as unknown as { toolInvocations?: GenericToolInvocation[] };
    const invocations = (msgParsed.toolInvocations ?? []).map((inv) => ({
      type: 'tool-result', // pseudo part
      toolCallId: inv.toolCallId,
      toolName: inv.toolName,
      state: 'output-available',
      result: inv.result,
      output: inv.output,
      args: inv.args,
      input: inv.input,
    }));

    const allParts = [...(m.parts ?? []), ...invocations];

    const toolParts = allParts.filter(
      (part) =>
        isToolOrDynamicToolUIPart(part as any) ||
        (part as unknown as { type?: string }).type === 'tool-result'
    );
    const hasTools = toolParts.length > 0;

    const shouldShowText = hasContent;

    // Detect if this message only contains proposal calls that have been superseded by a newer one in the journey
    const isTotallyEmptyAndOutdated =
      toolParts.length > 0 &&
      !shouldShowText &&
      toolParts.every((p) => {
        const toolName =
          getToolOrDynamicToolName(p as any) || (p as unknown as { toolName?: string }).toolName;
        if (
          toolName !== 'propose_search_sol_database' &&
          toolName !== 'propose_search_global_database'
        )
          return false;
        const toolCallId = (p as any).toolCallId || '';
        if (searchJourney && searchJourney.length > 0) {
          return searchJourney[searchJourney.length - 1].toolCallId !== toolCallId;
        }
        return false;
      });

    const handleCopy = () => {
      navigator.clipboard.writeText(textContent);
      setCopied(true);
      toast.success('Copiado!', { duration: 1800 });
      setTimeout(() => setCopied(false), 2000);
    };

    const isUser = m.role === 'user';
    const userInitial = userName ? userName[0].toUpperCase() : 'U';

    // Se a mensagem é vazia (outdated proposal), ou não tem conteúdo nenhum útil prosseguir, retorne null
    if (isTotallyEmptyAndOutdated) return null;
    if (!isUser && !hasContent && !hasTools && !isStreaming) return null;

    // ----------------------------------------------------------------
    // USER MESSAGE — bolha compacta à direita
    // ----------------------------------------------------------------
    if (isUser) {
      return (
        <div className="chat-message-enter flex items-end justify-end gap-2.5">
          <div className="bg-primary text-primary-foreground max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{textContent}</p>
          </div>
          <div className="bg-primary/15 text-primary ring-primary/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1">
            {userInitial}
          </div>
        </div>
      );
    }

    // ----------------------------------------------------------------
    // ASSISTANT MESSAGE — fullwidth, sem bolha, avatar lateral
    // ----------------------------------------------------------------
    return (
      <div className="chat-message-enter flex items-start gap-3">
        {/* Avatar */}
        <div className="bg-muted ring-border mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
          <Library className="text-primary h-3.5 w-3.5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Nome + streaming dots */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase select-none">
              C.O.R.E. AI
            </span>
            {isStreaming && (
              <span className="inline-flex gap-0.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="bg-primary/60 h-1 w-1 animate-bounce rounded-full"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            )}
          </div>

          {/* Markdown prose — suprimido quando a mensagem já renderiza um SearchJourneyCard */}
          {shouldShowText && (
            <>
              {/* ── STREAMING: texto puro sem ReactMarkdown para evitar DOM churn ── */}
              {isStreaming && (
                <div className="text-foreground/85 font-sans text-[14px] leading-[1.75] whitespace-pre-wrap">
                  {visibleText}
                  <span
                    className="text-primary/70 ml-0.5 inline-block animate-pulse select-none"
                    aria-hidden="true"
                  >
                    ▋
                  </span>
                </div>
              )}

              {/* ── CONCLUÍDO: ReactMarkdown renderizado uma única vez após o stream ── */}
              {!isStreaming && (
                <div className="animate-in fade-in prose prose-sm dark:prose-invert text-foreground max-w-none font-sans text-[14px] leading-relaxed duration-300">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      // H1 — usado exclusivamente para o título "# 📚 TL;DR Geral" da revisão
                      h1({ children }) {
                        return (
                          <h1 className="text-foreground border-primary/20 mt-2 mb-4 border-b-2 pb-2 text-[17px] font-bold tracking-tight first:mt-0">
                            {children}
                          </h1>
                        );
                      },
                      h2({ children }) {
                        return (
                          <h2 className="text-foreground border-border/30 mt-6 mb-2 border-b pb-1.5 text-[15px] font-bold tracking-tight first:mt-0">
                            {children}
                          </h2>
                        );
                      },
                      h3({ children }) {
                        return (
                          <h3 className="text-foreground/90 mt-4 mb-1.5 text-[13.5px] font-semibold">
                            {children}
                          </h3>
                        );
                      },
                      p({ children }) {
                        return (
                          <p className="text-foreground/85 my-2.5 text-[14px] leading-[1.75]">
                            {children}
                          </p>
                        );
                      },
                      ul({ children }) {
                        return <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>;
                      },
                      ol({ children }) {
                        return <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>;
                      },
                      li({ children }) {
                        return (
                          <li className="text-foreground/85 text-[14px] leading-[1.7]">
                            {children}
                          </li>
                        );
                      },
                      strong({ children }) {
                        return (
                          <strong className="text-foreground font-semibold">{children}</strong>
                        );
                      },
                      blockquote({ children }) {
                        return (
                          <blockquote className="border-primary/30 text-foreground/70 my-3 border-l-2 pl-4 italic">
                            {children}
                          </blockquote>
                        );
                      },
                      code({ children, className }) {
                        const isBlock = !!className?.includes('language-');
                        if (isBlock) {
                          const lang = className?.replace('language-', '') || '';
                          const codeStr = String(children).replace(/\n$/, '');
                          if (lang === 'mermaid') {
                            return <MermaidBlock code={codeStr} />;
                          }
                          return <CodeBlock code={codeStr} language={lang} />;
                        }
                        return (
                          <code className="bg-muted text-foreground/90 rounded px-1 py-0.5 font-mono text-[12px]">
                            {children}
                          </code>
                        );
                      },
                      table({ children }) {
                        const handleDownloadCsv = (e: React.MouseEvent) => {
                          const tableNode = (e.currentTarget as HTMLElement)
                            .closest('.asset-wrapper')
                            ?.querySelector('table');
                          if (!tableNode) return;

                          const rows = Array.from(tableNode.querySelectorAll('tr'));
                          const csv = rows
                            .map((row) => {
                              const cells = Array.from(row.querySelectorAll('th, td'));
                              return cells
                                .map((cell) => {
                                  const text = cell.textContent || '';
                                  return `"${text.replace(/"/g, '""')}"`;
                                })
                                .join(',');
                            })
                            .join('\n');

                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `tabela-${Date.now()}.csv`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                        };

                        return (
                          <div className="asset-wrapper">
                            <AssetWrapper
                              title="Tabela de Dados"
                              icon={<Table className="h-3.5 w-3.5" />}
                              onDownload={handleDownloadCsv as any}
                              downloadLabel="Baixar CSV"
                              contentClassName="p-0"
                              previewZoom={1}
                              previewFull
                            >
                              <div className="w-full overflow-x-auto">
                                <table className="divide-border/50 min-w-full divide-y">
                                  {children}
                                </table>
                              </div>
                            </AssetWrapper>
                          </div>
                        );
                      },
                      thead({ children }) {
                        return <thead className="bg-muted/40 dark:bg-muted/20">{children}</thead>;
                      },
                      th({ children }) {
                        return (
                          <th className="text-muted-foreground px-4 py-2 text-left text-[11px] font-bold tracking-tight uppercase">
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
                        return (
                          <td className="text-foreground/80 px-4 py-2 text-[13px]">{children}</td>
                        );
                      },
                      a({ href, children }) {
                        const isArticleLink = href?.startsWith('#article-row-');
                        return (
                          <a
                            href={href || '#'}
                            onClick={(e) => {
                              if (isArticleLink) {
                                e.preventDefault();
                                const id = (href as string).replace('#article-row-', '');
                                setHighlightedRow(id);
                                const el = document.getElementById(`article-row-${id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                            className={`font-semibold transition-all ${
                              isArticleLink
                                ? 'decoration-primary/40 hover:text-primary hover:decoration-primary underline decoration-2 underline-offset-4'
                                : 'text-primary hover:text-primary/80'
                            }`}
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {/* Mapeia [N] → link âncora para o artigo correspondente (G-03). */}
                    {textContent.replace(/\[(\d+)\]/g, (_, n: string) => {
                      const idx = parseInt(n, 10) - 1;
                      const article = articles?.[idx];
                      return article ? `[[**${n}**]](#article-row-${article.id})` : `[${n}]`;
                    })}
                  </ReactMarkdown>
                </div>
              )}
            </>
          )}

          {/* Tool parts — proposal cards + status pills */}
          {toolParts.length > 0 && (
            <div className="mt-3 space-y-2.5">
              {toolParts.map((part) => {
                const toolName =
                  getToolOrDynamicToolName(part as any) ||
                  (part as unknown as { toolName?: string }).toolName ||
                  '';
                const toolCallId = (part as any).toolCallId || '';
                const state = (part as any).state || '';
                type ToolPart = {
                  output?: Record<string, unknown>;
                  result?: Record<string, unknown>;
                  input?: Record<string, unknown>;
                  args?: Record<string, unknown>;
                  toolInvocation?: {
                    result?: Record<string, unknown>;
                    output?: Record<string, unknown>;
                    args?: Record<string, unknown>;
                    input?: Record<string, unknown>;
                  };
                };

                const p = part as ToolPart;
                const output = (p.output ||
                  p.result ||
                  p.toolInvocation?.result ||
                  p.toolInvocation?.output) as Record<string, unknown> | undefined;
                const input = (p.input ||
                  p.args ||
                  p.toolInvocation?.args ||
                  p.toolInvocation?.input) as Record<string, unknown> | undefined;

                // Proposal cards — SearchJourneyCard unificado (último) ou null (demais)
                if (
                  (toolName === 'propose_search_sol_database' ||
                    toolName === 'propose_search_global_database') &&
                  (state === 'output-available' ||
                    state === 'input-available' ||
                    state === 'input-streaming')
                ) {
                  // Com searchJourney: usa card unificado — só renderiza no último
                  if (searchJourney && searchJourney.length > 0) {
                    const lastAttempt = searchJourney[searchJourney.length - 1];
                    if (lastAttempt.toolCallId !== toolCallId) {
                      // Esta proposal foi superada — escondida no card unificado
                      return null;
                    }
                    return (
                      <SearchJourneyCard
                        key={toolCallId}
                        attempts={searchJourney}
                        onCancel={onCancelSearch}
                      />
                    );
                  }

                  // Fallback sem journey — cards individuais (comportamento anterior)
                  if (toolName === 'propose_search_sol_database') {
                    const queries = (output?.queries ?? input?.queries) as string[] | undefined;
                    const queryId = (output?.query_id ?? undefined) as string | undefined;
                    if (!queries || queries.length === 0) return null;
                    const similarQuery = (output?.similar_query ?? null) as SimilarQueryInfo | null;
                    return (
                      <>
                        {similarQuery && output?.similar_query_found && (
                          <SimilarQueryBanner key={`banner-${toolCallId}`} info={similarQuery} />
                        )}
                        <SearchProposalCard
                          key={toolCallId}
                          queries={queries}
                          queryId={queryId}
                          onExecute={onExecuteSearch}
                          onCancel={onCancelSearch}
                          isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                          isRunning={queryId ? (runningSearches?.has(queryId) ?? false) : false}
                        />
                      </>
                    );
                  }
                  const query = (output?.query ?? input?.query) as string | undefined;
                  const queryId = (output?.query_id ?? undefined) as string | undefined;
                  if (!query) return null;
                  return (
                    <GlobalSearchProposalCard
                      key={toolCallId}
                      query={query}
                      queryId={queryId}
                      onCancel={onCancelSearch}
                      isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                      isRunning={queryId ? (runningSearches?.has(queryId) ?? false) : false}
                    />
                  );
                }

                // Status pills
                const cfg = getToolStatus(toolName, state, output, isStreaming, !!textContent);
                if (!cfg) return null;
                return (
                  <div
                    key={toolCallId}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium whitespace-nowrap shadow-sm ${PILL_CLS[cfg.variant]}`}
                  >
                    {cfg.variant === 'loading' ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : (
                      cfg.icon
                    )}
                    {cfg.label}
                  </div>
                );
              })}
            </div>
          )}

          {/* Copy button — sempre visível */}
          {!isStreaming && hasContent && (
            <div className="mt-2.5 flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" />
                    <span className="text-emerald-500">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copiar
                  </>
                )}
              </button>

              {/* Feedback pós-síntese — Fase C (IA-05) */}
              {isSynthesisMessage && (
                <>
                  <div className="bg-border/30 mx-1 h-3 w-px" />
                  <button
                    type="button"
                    onClick={() => {
                      const next = feedback === 'up' ? null : 'up';
                      void handleFeedback(next);
                      if (next === 'up')
                        toast.success('Obrigado pelo feedback!', { duration: 1800 });
                    }}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      feedback === 'up'
                        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title="Síntese útil"
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = feedback === 'down' ? null : 'down';
                      void handleFeedback(next);
                      if (next === 'down')
                        toast.info('Feedback registrado — vamos melhorar!', { duration: 2200 });
                    }}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      feedback === 'down'
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title="Síntese imprecisa"
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Durante streaming o SDK pode mutar o objeto message in-place.
    // Forçar re-render em cada ciclo enquanto a mensagem está sendo escrita.
    if (nextProps.isStreaming) return false;
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    if (prevProps.userName !== nextProps.userName) return false;
    if (prevProps.executedProposalIds?.size !== nextProps.executedProposalIds?.size) return false;
    if (prevProps.runningSearches?.size !== nextProps.runningSearches?.size) return false;
    if (prevProps.searchJourney?.length !== nextProps.searchJourney?.length) return false;
    const prevText =
      (
        prevProps.m.parts?.find((p) => p.type === 'text') as
          | { type: 'text'; text: string }
          | undefined
      )?.text ?? '';
    const nextText =
      (
        nextProps.m.parts?.find((p) => p.type === 'text') as
          | { type: 'text'; text: string }
          | undefined
      )?.text ?? '';
    if (prevText !== nextText) return false;
    const prevTools = JSON.stringify(prevProps.m.parts?.filter(isToolOrDynamicToolUIPart) ?? []);
    const nextTools = JSON.stringify(nextProps.m.parts?.filter(isToolOrDynamicToolUIPart) ?? []);
    if (prevTools !== nextTools) return false;
    return true;
  }
);
ChatMessageItem.displayName = 'ChatMessageItem';

'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from 'react';
import { type UIMessage, isToolOrDynamicToolUIPart, getToolOrDynamicToolName } from 'ai';
import { Library, Copy, Check, Loader2, Search, Globe, FileText, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { SearchProposalCard, GlobalSearchProposalCard } from './proposals';
import type { ExecuteSearchFn } from './proposals';

// ---------------------------------------------------------------------------
// TypingIndicator — ChatGPT style (sem bolha, avatar lateral)
// ---------------------------------------------------------------------------
export const TypingIndicator = () => (
  <div className="flex items-start gap-3">
    <div className="bg-muted ring-border mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
      <Library className="text-primary h-3.5 w-3.5" />
    </div>
    <div className="flex flex-col gap-1 pt-0.5">
      <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase select-none">
        SOL Assistant
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
    // (b) stream já terminou E a mensagem mãe tem texto (LLM respondeu após a tool).
    // Isso evita o loader travado quando o SDK não transiciona o state no 2º ciclo.
    const isDone = state === 'output-available' || (!isStreaming && hasMessageText);
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
  }: ChatMessageItemProps) => {
    const [copied, setCopied] = useState(false);

    const textContent =
      (m.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
        ?.text ?? '';

    // Texto visível: o smoothStream (backend) já envia palavra a palavra,
    // portanto renderizamos textContent diretamente — sem typewriter manual.
    const visibleText = textContent;

    const toolParts = m.parts?.filter(isToolOrDynamicToolUIPart) ?? [];

    const handleCopy = () => {
      navigator.clipboard.writeText(textContent);
      setCopied(true);
      toast.success('Copiado!', { duration: 1800 });
      setTimeout(() => setCopied(false), 2000);
    };

    const isUser = m.role === 'user';
    const userInitial = userName ? userName[0].toUpperCase() : 'U';

    const hasContent = textContent.trim().length > 0;
    const hasTools = toolParts.length > 0;
    if (!isUser && !hasContent && !hasTools && !isStreaming) return null;

    // ----------------------------------------------------------------
    // USER MESSAGE — bolha compacta à direita
    // ----------------------------------------------------------------
    if (isUser) {
      return (
        <div className="flex items-end justify-end gap-2.5">
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
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="bg-muted ring-border mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1">
          <Library className="text-primary h-3.5 w-3.5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Nome + streaming dots */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase select-none">
              SOL Assistant
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

          {/* Markdown prose */}
          {hasContent && (
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
                <div className="prose prose-sm dark:prose-invert text-foreground max-w-none font-sans text-[14px] leading-relaxed">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
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
                        return isBlock ? (
                          <code className={className}>{children}</code>
                        ) : (
                          <code className="bg-muted text-foreground/90 rounded px-1 py-0.5 font-mono text-[12px]">
                            {children}
                          </code>
                        );
                      },
                      table({ children }) {
                        return (
                          <div className="border-border/50 my-4 w-full overflow-x-auto rounded-lg border">
                            <table className="divide-border/50 min-w-full divide-y">
                              {children}
                            </table>
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
                const toolName = getToolOrDynamicToolName(part);
                const toolCallId = part.toolCallId;
                const state = part.state;
                const output = (part as any).output as Record<string, any> | undefined;
                const input = (part as any).input as Record<string, any> | undefined;

                // Proposal cards interativos
                if (
                  toolName === 'propose_search_sol_database' &&
                  (state === 'output-available' ||
                    state === 'input-available' ||
                    state === 'input-streaming') &&
                  (output?.proposed || output?.queries || input?.queries)
                ) {
                  const queries: string[] | undefined = output?.queries ?? input?.queries;
                  const queryId: string | undefined = output?.query_id ?? undefined;
                  if (!queries || queries.length === 0) return null;
                  return (
                    <SearchProposalCard
                      key={toolCallId}
                      queries={queries}
                      queryId={queryId}
                      onExecute={onExecuteSearch}
                      onCancel={onCancelSearch}
                      isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                      isRunning={queryId ? (runningSearches?.has(queryId) ?? false) : false}
                    />
                  );
                }

                if (
                  toolName === 'propose_search_global_database' &&
                  (state === 'output-available' ||
                    state === 'input-available' ||
                    state === 'input-streaming') &&
                  (output?.proposed || output?.query || input?.query)
                ) {
                  const query: string | undefined = output?.query ?? input?.query;
                  const queryId: string | undefined = output?.query_id ?? undefined;
                  if (!query) return null;
                  return (
                    <GlobalSearchProposalCard
                      key={toolCallId}
                      query={query}
                      queryId={queryId}
                      onExecute={onExecuteSearch}
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
            <div className="mt-2.5">
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

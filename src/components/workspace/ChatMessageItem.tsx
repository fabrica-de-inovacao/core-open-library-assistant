'use client';

import React, { useState } from 'react';
import { UIMessage, isToolOrDynamicToolUIPart, getToolOrDynamicToolName } from 'ai';
import { Library, Copy, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SearchProposalCard, GlobalSearchProposalCard } from './proposals';
import type { ExecuteSearchFn } from './proposals';

// ---------------------------------------------------------------------------
// TypingIndicator
// ---------------------------------------------------------------------------
export const TypingIndicator = () => (
  <div className="chat-message-enter flex flex-col items-start">
    <div className="border-border bg-card text-foreground max-w-[90%] rounded-xl border px-4 py-3 shadow-sm">
      <span className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
        SOL Assistant
      </span>
      <div className="flex items-center gap-1.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground/50 block h-2 w-2 rounded-full"
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
// ChatMessageItem
// ---------------------------------------------------------------------------
interface ChatMessageItemProps {
  m: UIMessage;
  /** G-03: highlightedRow agora usa UUID em vez de número de linha */
  setHighlightedRow: (value: string | null) => void;
  articles?: Array<{ id: string }>;
  isStreaming: boolean;
  userName?: string | null;
  onExecuteSearch?: ExecuteSearchFn;
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
    executedProposalIds,
    runningSearches,
  }: ChatMessageItemProps) => {
    const [copied, setCopied] = useState(false);

    // Extrai texto de m.parts (UIMessage — sem m.content)
    const textContent =
      (m.parts?.find((p) => p.type === 'text') as { type: 'text'; text: string } | undefined)
        ?.text ?? '';

    const toolParts = m.parts?.filter(isToolOrDynamicToolUIPart) ?? [];

    const handleCopy = () => {
      navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const isUser = m.role === 'user';
    const userInitial = userName ? userName[0].toUpperCase() : 'U';

    // Não renderiza bolha de assistente vazia (ex: thinking-only responses do Gemini 2.5)
    const hasContent = textContent.trim().length > 0;
    const hasTools = toolParts.length > 0;
    if (!isUser && !hasContent && !hasTools && !isStreaming) return null;

    return (
      <div
        className={`chat-message-enter flex items-end gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {/* Avatar */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm transition-transform hover:scale-105 ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-primary ring-primary/20 ring-1 dark:bg-zinc-900'
          }`}
        >
          {isUser ? userInitial : <Library className="h-4 w-4" />}
        </div>

        {/* Message Content Wrapper */}
        <div
          className={`group relative flex max-w-[85%] flex-col ${isUser ? 'items-end' : 'items-start'}`}
        >
          <span
            className={`mb-1.5 flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase ${
              isUser ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {isUser ? userName || 'Você' : 'SOL Assistant'}
            {isStreaming && (
              <span className="inline-flex gap-0.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="bg-primary h-1 w-1 animate-bounce rounded-full"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            )}
          </span>

          <div
            className={`relative w-full rounded-2xl px-4 py-3 shadow-sm ring-1 transition-all ring-inset ${
              isUser
                ? 'bg-primary text-primary-foreground ring-primary/50 rounded-tr-sm'
                : 'border-border bg-card text-foreground ring-border/50 rounded-tl-sm border'
            }`}
          >
            <div
              className={`prose prose-sm max-w-none font-sans text-[14px] leading-relaxed ${
                isUser
                  ? 'prose-invert text-primary-foreground'
                  : 'text-foreground dark:prose-invert'
              }`}
            >
              {isStreaming ? (
                <p className="m-0 whitespace-pre-wrap">{textContent}</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table({ children }) {
                      return (
                        <div className="my-4 w-full overflow-x-auto rounded-lg border border-zinc-200/50 dark:border-zinc-800/50">
                          <table className="min-w-full divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
                            {children}
                          </table>
                        </div>
                      );
                    },
                    thead({ children }) {
                      return (
                        <thead className="bg-zinc-50/50 dark:bg-zinc-900/50">{children}</thead>
                      );
                    },
                    th({ children }) {
                      return (
                        <th className="px-4 py-2 text-left text-[11px] font-bold tracking-tight text-zinc-500 uppercase">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return (
                        <td className="px-4 py-2 text-[13px] text-zinc-600 dark:text-zinc-300">
                          {children}
                        </td>
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
                              // G-03: id agora é UUID — sem parseInt
                              const id = (href as string).replace('#article-row-', '');
                              setHighlightedRow(id);
                              const el = document.getElementById(`article-row-${id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                          }}
                          className={`${
                            isArticleLink
                              ? 'decoration-primary/30 hover:text-primary hover:decoration-primary underline decoration-2 underline-offset-4'
                              : 'text-primary hover:text-primary/80 dark:text-primary'
                          } font-semibold transition-all`}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {textContent.replace(/\[(\d+)\]/g, (_, n: string) => {
                    // G-03: mapear [N] → UUID do N-ésimo artigo na lista
                    const idx = parseInt(n, 10) - 1;
                    const article = articles?.[idx];
                    return article ? `[[**${n}**]](#article-row-${article.id})` : `[${n}]`;
                  })}
                </ReactMarkdown>
              )}
            </div>

            {/* Tool Indicators / Interactive Cards */}
            {toolParts.length > 0 && (
              <div className="space-y-3">
                {toolParts.map((part) => {
                  const toolName = getToolOrDynamicToolName(part);
                  const toolCallId = part.toolCallId;
                  const state = part.state;
                  // ai@5 UIMessage: output = tool result, input = tool args
                  const output = (part as any).output as Record<string, any> | undefined;
                  const input = (part as any).input as Record<string, any> | undefined;

                  console.log(`[UI] Tool Item: ${toolName}, state: ${state}, output:`, output);

                  // 1. Rendering Interactive Proposal Cards
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
                        isExecuted={queryId ? executedProposalIds?.has(queryId) : false}
                        isRunning={queryId ? (runningSearches?.has(queryId) ?? false) : false}
                      />
                    );
                  }

                  // 2. Rendering Progress Pills
                  let loadingText = 'Processando...';
                  let successText = 'Concluído';
                  let isError = false;

                  if (toolName === 'search_sol_database' || toolName === 'search_global_database') {
                    loadingText =
                      toolName === 'search_global_database'
                        ? 'Buscando Global (OpenAlex)...'
                        : 'Buscando base de dados...';
                    if (state === 'output-available') {
                      if (output?.success === false || output?.total_found === 0) {
                        successText = 'Nenhum resultado.';
                        isError = true;
                      } else {
                        successText = `${output?.total_found} artigos — Extração iniciada.`;
                      }
                    }
                  } else if (toolName === 'generate_systematic_review') {
                    loadingText = 'Gerando síntese sistemática...';
                    successText = 'Revisão concluída.';
                  } else if (
                    toolName === 'propose_search_sol_database' ||
                    toolName === 'propose_search_global_database'
                  ) {
                    if (state === 'output-available') return null;
                    loadingText = 'Elaborando estratégia de busca...';
                  }

                  return (
                    <div
                      key={toolCallId}
                      className={`mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] whitespace-nowrap shadow-sm transition-all ${
                        state === 'output-available'
                          ? isError
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-sky-200 bg-sky-50 text-sky-700'
                      }`}
                    >
                      {state === 'output-available' ? (
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        />
                      ) : (
                        <Loader2 className="text-primary h-3 w-3 animate-spin" />
                      )}
                      {state === 'output-available' ? successText : loadingText}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Assistant Actions (Copy) */}
          {!isUser && !isStreaming && (
            <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={handleCopy}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors"
              >
                {copied ? (
                  <>
                    <span className="text-emerald-500">✓</span> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copiar
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
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    if (prevProps.userName !== nextProps.userName) return false;
    if (prevProps.executedProposalIds?.size !== nextProps.executedProposalIds?.size) return false;
    // Compare text content via parts
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
    // Compare tool parts
    const prevTools = JSON.stringify(prevProps.m.parts?.filter(isToolOrDynamicToolUIPart) ?? []);
    const nextTools = JSON.stringify(nextProps.m.parts?.filter(isToolOrDynamicToolUIPart) ?? []);
    if (prevTools !== nextTools) return false;
    return true;
  }
);
ChatMessageItem.displayName = 'ChatMessageItem';

'use client';

import { useState } from 'react';
import { BookOpen, MessageSquare, ExternalLink, User, Library } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SidebarArticle {
  id: string;
  title: string | null;
  authors: string | null;
  publicationYear: number | null;
  sourceName: string | null;
  originalUrl: string | null;
  isOpenAccess: boolean | null;
  tldrContent: string | null;
}

export interface SidebarMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface ShareSidebarProps {
  articles: SidebarArticle[];
  messages: SidebarMessage[];
}

type Panel = 'acervo' | 'chat';

// ── Main Component ────────────────────────────────────────────────────────────

export function ShareSidebar({ articles, messages }: ShareSidebarProps) {
  // null = collapsed; 'acervo'|'chat' = expanded with that panel active
  const [activePanel, setActivePanel] = useState<Panel | null>(null);

  const toggle = (panel: Panel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const isExpanded = activePanel !== null;

  return (
    <div
      className="relative flex h-full shrink-0 border-l border-border bg-background transition-[width] duration-300 ease-in-out"
      style={{ width: isExpanded ? 360 : 48 }}
    >
      {/* ── Icon strip (always visible) ─────────────────────────────────── */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 pt-3">
        <IconTab
          label="Acervo"
          count={articles.length}
          icon={<BookOpen className="size-4" />}
          active={activePanel === 'acervo'}
          onClick={() => toggle('acervo')}
        />
        <IconTab
          label="Chat"
          count={messages.length}
          icon={<MessageSquare className="size-4" />}
          active={activePanel === 'chat'}
          onClick={() => toggle('chat')}
        />
      </div>

      {/* ── Expanded panel ──────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-border">
          {/* Panel label header */}
          <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {activePanel === 'acervo' ? 'Acervo' : 'Chat'}
            </span>
            <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px] tabular-nums">
              {activePanel === 'acervo' ? articles.length : messages.length}
            </Badge>
          </div>

          {/* Scrollable panel content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activePanel === 'acervo' ? (
              <AcervoPanel articles={articles} />
            ) : (
              <ChatPanel messages={messages} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icon Tab ──────────────────────────────────────────────────────────────────

function IconTab({
  label,
  count,
  icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative flex w-9 flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      <span className="leading-none">{label}</span>
      {count > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums ${
            active
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted-foreground/20 text-muted-foreground'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

// ── Acervo Panel ──────────────────────────────────────────────────────────────

function AcervoPanel({ articles }: { articles: SidebarArticle[] }) {
  const done = articles.filter((a) => a.title);

  if (done.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <BookOpen className="size-8 opacity-25" />
        <p className="text-sm">Nenhum artigo processado.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {done.map((article, idx) => (
        <li key={article.id} className="px-4 py-3.5 hover:bg-muted/40 transition-colors">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">
              [{idx + 1}]
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              {article.originalUrl ? (
                <a
                  href={article.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-[12.5px] font-medium leading-snug hover:text-primary hover:underline"
                >
                  {article.title}
                  <ExternalLink className="ml-0.5 inline size-2.5 opacity-40" />
                </a>
              ) : (
                <p className="line-clamp-2 text-[12.5px] font-medium leading-snug">
                  {article.title}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {article.authors && (
                  <span className="max-w-[180px] truncate">
                    {article.authors.split(';')[0]?.trim()}
                  </span>
                )}
                {article.publicationYear && (
                  <>
                    <span className="opacity-40">·</span>
                    <span>{article.publicationYear}</span>
                  </>
                )}
                {article.isOpenAccess && (
                  <Badge
                    variant="outline"
                    className="h-3.5 border-emerald-300 px-1 py-0 text-[9px] text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                  >
                    OA
                  </Badge>
                )}
              </div>

              {article.tldrContent && (
                <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                  {article.tldrContent}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function ChatPanel({ messages }: { messages: SidebarMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <MessageSquare className="size-8 opacity-25" />
        <p className="text-sm">Nenhuma mensagem registrada.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-4">
      {messages.map((msg) =>
        msg.role === 'user' ? (
          <UserBubble key={msg.id} text={msg.text} />
        ) : (
          <AssistantBubble key={msg.id} text={msg.text} />
        )
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end justify-end gap-2">
      <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-primary-foreground shadow-sm">
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
      <div className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
        <User className="size-3" />
      </div>
    </div>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border">
        <Library className="size-3 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          C.O.R.E.
        </span>
        <div className="prose prose-sm dark:prose-invert max-w-none text-[12.5px] leading-relaxed [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-[12.5px] [&_h3]:font-semibold [&_p]:my-1.5 [&_ul]:my-1 [&_ul]:ml-4 [&_ol]:my-1 [&_ol]:ml-4 [&_li]:my-0.5 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children }) {
                if (className?.includes('language-mermaid')) return null;
                return (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                    {children}
                  </code>
                );
              },
              a({ href, children }) {
                if (!href || href.startsWith('#')) return <span>{children}</span>;
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  BookOpen,
  MessageSquare,
  ExternalLink,
  User,
  Library,
  ChevronsDown,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidBlock, CodeBlock } from '@/components/workspace/AssetRenderers';

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
  const [activePanel, setActivePanel] = useState<Panel | null>(null);

  const toggle = (panel: Panel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  const close = () => setActivePanel(null);
  const isExpanded = activePanel !== null;

  const panelLabel = activePanel === 'acervo' ? 'Acervo' : 'Chat';
  const panelCount = activePanel === 'acervo' ? articles.length : messages.length;

  return (
    <>
      {/* ── DESKTOP: inline collapsible side panel ──────────────────────── */}
      <div
        className="relative hidden h-full shrink-0 flex-row border-l border-border bg-background transition-[width] duration-300 ease-in-out md:flex"
        style={{ width: isExpanded ? 580 : 48 }}
      >
        {/* Icon strip */}
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

        {/* Expanded content */}
        {isExpanded && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-border">
            <PanelHeader label={panelLabel} count={panelCount} onClose={close} />
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

      {/* ── MOBILE: fixed bottom bar + overlay sheet ─────────────────────── */}
      <div className="md:hidden">
        {/* Bottom icon bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center justify-around border-t border-border bg-background/95 backdrop-blur-sm">
          <MobileTab
            label="Acervo"
            count={articles.length}
            icon={<BookOpen className="size-5" />}
            active={activePanel === 'acervo'}
            onClick={() => toggle('acervo')}
          />
          <MobileTab
            label="Chat"
            count={messages.length}
            icon={<MessageSquare className="size-5" />}
            active={activePanel === 'chat'}
            onClick={() => toggle('chat')}
          />
        </div>

        {/* Sheet overlay */}
        {isExpanded && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
              onClick={close}
            />
            {/* Slide-up panel */}
            <div className="fixed bottom-14 left-0 right-0 z-50 flex max-h-[75vh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl">
              <PanelHeader label={panelLabel} count={panelCount} onClose={close} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {activePanel === 'acervo' ? (
                  <AcervoPanel articles={articles} />
                ) : (
                  <ChatPanel messages={messages} />
                )}
              </div>
            </div>
          </>
        )}

        {/* Bottom padding so main content isn't hidden by the bar */}
        <div className="h-14" />
      </div>
    </>
  );
}

// ── Panel Header with close button ───────────────────────────────────────────

function PanelHeader({
  label,
  count,
  onClose,
}: {
  label: string;
  count: number;
  onClose: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px] tabular-nums">
        {count}
      </Badge>
      <button
        onClick={onClose}
        title="Fechar"
        className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ── Desktop icon tab ──────────────────────────────────────────────────────────

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

// ── Mobile tab (bottom bar) ───────────────────────────────────────────────────

function MobileTab({
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
      className={`relative flex flex-col items-center gap-1 px-6 py-1 text-[10px] font-semibold transition-colors ${
        active ? 'text-primary' : 'text-muted-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`absolute top-1 right-4 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold ${
            active
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted-foreground/30 text-muted-foreground'
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
                  className="line-clamp-2 text-[13px] font-medium leading-snug hover:text-primary hover:underline"
                >
                  {article.title}
                  <ExternalLink className="ml-0.5 inline size-2.5 opacity-40" />
                </a>
              ) : (
                <p className="line-clamp-2 text-[13px] font-medium leading-snug">{article.title}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {article.authors && (
                  <span className="max-w-[200px] truncate">
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScroll, setShowScroll] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () =>
      setShowScroll(el.scrollHeight - el.scrollTop - el.clientHeight > 150);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <MessageSquare className="size-8 opacity-25" />
        <p className="text-sm">Nenhuma mensagem registrada.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserBubble key={msg.id} text={msg.text} />
            ) : (
              <AssistantBubble key={msg.id} text={msg.text} />
            )
          )}
        </div>
      </div>
      {showScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border hover:bg-muted transition-colors"
          title="Ir para o fim"
        >
          <ChevronsDown className="size-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ── Bubbles ───────────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end justify-end gap-2">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground shadow-sm">
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
      <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
        <User className="size-3.5" />
      </div>
    </div>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted ring-1 ring-border">
        <Library className="size-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          C.O.R.E.
        </span>
        <div className="prose prose-sm dark:prose-invert max-w-none font-sans text-[14px] leading-relaxed [&_h1]:mb-3 [&_h1]:mt-2 [&_h1]:text-[15px] [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_li]:my-0.5 [&_li]:text-[14px] [&_ol]:my-1.5 [&_ol]:ml-4 [&_p]:my-2 [&_p]:text-[14px] [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:ml-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children }) {
                const lang = className?.replace('language-', '') ?? '';
                const codeStr = String(children).replace(/\n$/, '');
                if (lang === 'mermaid') return <MermaidBlock code={codeStr} />;
                if (lang) return <CodeBlock code={codeStr} language={lang} />;
                return (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                    {children}
                  </code>
                );
              },
              table({ children }) {
                return (
                  <div className="my-3 w-full overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full divide-y divide-border">{children}</table>
                  </div>
                );
              },
              thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
              th: ({ children }) => (
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-tight text-muted-foreground">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-4 py-2 text-[13px] text-foreground/80">{children}</td>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-3 border-l-2 border-primary/30 pl-4 italic text-foreground/70">
                  {children}
                </blockquote>
              ),
              a({ href, children }) {
                if (!href || href.startsWith('#')) return <span>{children}</span>;
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
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

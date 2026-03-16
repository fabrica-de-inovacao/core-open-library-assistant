'use client';

import { useState } from 'react';
import { BookOpen, MessageSquare, ExternalLink, User, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareSidebar({ articles, messages }: ShareSidebarProps) {
  const [activePanel, setActivePanel] = useState<'acervo' | 'chat'>('acervo');

  const doneArticles = articles.filter(
    (a) => a.title && a.originalUrl
  );

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-background/60 backdrop-blur-sm">
      {/* Toggle buttons */}
      <div className="flex shrink-0 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActivePanel('acervo')}
          className={`flex-1 rounded-none gap-1.5 text-xs font-medium h-11 ${
            activePanel === 'acervo'
              ? 'border-b-2 border-primary text-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BookOpen className="size-3.5" />
          Acervo
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {doneArticles.length}
          </Badge>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActivePanel('chat')}
          className={`flex-1 rounded-none gap-1.5 text-xs font-medium h-11 ${
            activePanel === 'chat'
              ? 'border-b-2 border-primary text-primary bg-primary/5'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageSquare className="size-3.5" />
          Chat
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {messages.length}
          </Badge>
        </Button>
      </div>

      {/* Panel content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activePanel === 'acervo' ? (
          <AcervoPanel articles={doneArticles} />
        ) : (
          <ChatPanel messages={messages} />
        )}
      </div>
    </aside>
  );
}

// ── Acervo Panel ──────────────────────────────────────────────────────────────

function AcervoPanel({ articles }: { articles: SidebarArticle[] }) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <BookOpen className="size-8 opacity-30" />
        <p className="text-sm">Nenhum artigo processado.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {articles.map((article, idx) => (
        <li key={article.id} className="group px-4 py-3 hover:bg-muted/40 transition-colors">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">
              [{idx + 1}]
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              {article.originalUrl ? (
                <a
                  href={article.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-xs font-medium leading-snug hover:text-primary hover:underline"
                >
                  {article.title}
                  <ExternalLink className="ml-0.5 inline size-2.5 opacity-50" />
                </a>
              ) : (
                <p className="line-clamp-2 text-xs font-medium leading-snug">{article.title}</p>
              )}
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                {article.authors && (
                  <span className="max-w-[150px] truncate">{article.authors.split(';')[0]}</span>
                )}
                {article.publicationYear && (
                  <>
                    <span>·</span>
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
                <p className="line-clamp-2 text-[10px] text-muted-foreground leading-relaxed">
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
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <MessageSquare className="size-8 opacity-30" />
        <p className="text-sm">Nenhuma mensagem registrada.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          {/* Avatar */}
          <div
            className={`shrink-0 rounded-full p-1.5 ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {msg.role === 'user' ? (
              <User className="size-3" />
            ) : (
              <Bot className="size-3" />
            )}
          </div>

          {/* Bubble */}
          <div
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'rounded-tr-sm bg-primary text-primary-foreground'
                : 'rounded-tl-sm bg-muted text-foreground'
            }`}
          >
            {msg.text}
          </div>
        </div>
      ))}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Ellipsis, PencilLine, Share2, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuItem } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { truncate } from '@/lib/utils';
import type { RecentChat } from '@/server/actions/chat';

// ── Skeleton ───────────────────────────────────────────────────────────────

export function RecentChatsSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-1 py-0.5">
          <Skeleton
            className="h-7 w-full rounded-lg opacity-60"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        </div>
      ))}
    </>
  );
}

// ── Item ───────────────────────────────────────────────────────────────────

export interface RecentChatItemProps {
  chat: RecentChat;
  active: boolean;
  onShare: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}

export function RecentChatItem({ chat, active, onShare, onRename, onDelete }: RecentChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? '');
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showActions = hovered || menuOpen;

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (chat.title ?? '')) onRename(trimmed);
    setRenaming(false);
  };

  const startRename = () => {
    setMenuOpen(false);
    setDraft(chat.title ?? '');
    setRenaming(true);
  };

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  return (
    <SidebarMenuItem>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'relative flex h-8 w-full items-center rounded transition-colors duration-100',
          active ? 'bg-sidebar-accent' : hovered || menuOpen ? 'bg-sidebar-accent/60' : ''
        )}
      >
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="border-border/50 text-foreground placeholder:text-muted-foreground/40 focus:ring-primary/30 w-full rounded border bg-transparent px-2 text-[12px] focus:ring-1 focus:outline-none"
            placeholder="Nome da sessão…"
          />
        ) : (
          <Link
            href={`/workspace/chat/${chat.id}`}
            className={cn(
              'block min-w-0 flex-1 truncate py-1 text-[12.5px] leading-snug transition-colors duration-100',
              showActions ? 'pr-7 pl-2' : 'px-2',
              active
                ? 'text-sidebar-foreground font-medium'
                : hovered
                  ? 'text-sidebar-foreground'
                  : 'text-sidebar-foreground/60'
            )}
          >
            {truncate(chat.title)}
          </Link>
        )}

        {!renaming && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Ações da sessão"
                onClick={(e) => e.preventDefault()}
                className={cn(
                  'absolute right-1 flex size-5 shrink-0 items-center justify-center rounded',
                  'transition-all duration-100',
                  showActions ? 'opacity-100' : 'pointer-events-none opacity-0',
                  menuOpen
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                )}
              >
                <Ellipsis size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              sideOffset={4}
              className="animate-in fade-in-0 zoom-in-95 w-44 duration-100"
            >
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onShare();
                }}
                className="cursor-pointer gap-2 text-[13px]"
              >
                <Share2 size={14} className="text-muted-foreground" />
                Compartilhar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={startRename} className="cursor-pointer gap-2 text-[13px]">
                <PencilLine size={14} className="text-muted-foreground" />
                Renomear
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer gap-2 text-[13px]"
              >
                <Trash2 size={14} className="text-destructive" />
                Excluir sessão
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </SidebarMenuItem>
  );
}

'use client';

import { useState } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import { BookOpenText, MessagesSquare, PanelLeft, PanelLeftClose, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn, isActive } from '@/lib/utils';
import { ShareDialog } from '@/components/ShareDialog';
import { useRecentChats } from '@/hooks/useRecentChats';
import { SIDEBAR_ICON_WIDTH, NAV_ROUTES } from '@/components/sidebar/sidebar.config';
import { NavItem } from '@/components/sidebar/NavItem';
import { RecentChatItem, RecentChatsSkeleton } from '@/components/sidebar/RecentChatItem';
import { UserMenuPopover } from '@/components/sidebar/UserMenuPopover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActiveChat } from '@/contexts/ActiveChatContext';

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { state, toggleSidebar } = useSidebar();

  const { chats, isLoading, rename, remove } = useRecentChats(session?.user?.id, pathname);
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(null);

  // UX-01: guard do "Nova Sessão" — intercepta navegação quando um chat está em andamento
  const { requestNavigation, chatIsLocked } = useActiveChat();

  const handleDelete = async (chatId: string) => {
    if (isActive(pathname, `/workspace/chat/${chatId}`)) router.push('/workspace');
    await remove(chatId);
  };

  return (
    <>
      <Sidebar
        variant="sidebar"
        collapsible="icon"
        className="border-sidebar-border overflow-hidden border-r"
        style={{ '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as React.CSSProperties}
      >
        {/* ── Header ── */}
        <SidebarHeader className="group/header border-sidebar-border/60 h-14 items-center justify-between border-b px-3">
          <div className="flex h-full w-full items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <Link href="/workspace" className="flex shrink-0 items-center gap-2 group-data-[collapsible=icon]:group-hover/header:hidden">
              <div className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-90">
                <BookOpenText size={14} className="text-primary-foreground" />
              </div>
            </Link>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="hidden group-data-[collapsible=icon]:group-hover/header:flex bg-background border-border text-foreground/70 hover:bg-accent hover:text-foreground size-7 shrink-0 items-center justify-center rounded-md border shadow-sm transition-colors"
                  aria-label="Expandir menu"
                >
                  <PanelLeft size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expandir menu
              </TooltipContent>
            </Tooltip>
            <div className="flex min-w-0 flex-1 flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="text-sidebar-foreground truncate text-[13px] font-semibold tracking-tight">
                C.O.R.E. AI
              </span>
              <span className="text-sidebar-foreground/35 font-mono text-[8px] tracking-[0.15em] uppercase">
                SCBC · 2026
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground ml-auto flex size-7 shrink-0 items-center justify-center rounded transition-colors group-data-[collapsible=icon]:hidden"
                  aria-label="Colapsar menu"
                >
                  <PanelLeftClose size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Colapsar menu
              </TooltipContent>
            </Tooltip>
          </div>
        </SidebarHeader>

        {/* ── Content ── */}
        <SidebarContent className="gap-0 overflow-x-hidden px-2.5 py-3 group-data-[collapsible=icon]:px-0">
          {/* ── Zona primária: ação + nav principal ─────────────────────────
              Fundo levemente elevado para criar hierarquia visual clara.
              No modo colapsado (icon only) remove o padding lateral. */}
          <div className="bg-sidebar-accent/20 mb-2 rounded-lg p-2.5 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:px-0">
            {/* CTA — Nova Sessão */}
            <div className="pb-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pb-2">
              {/* open={undefined} quando collapsed = Radix gerencia; open={false} quando expanded = nunca mostra */}
              <Tooltip open={state === 'collapsed' ? undefined : false}>
                <TooltipTrigger asChild>
                  <Link
                    href="/workspace"
                    onClick={(e) => {
                      if (chatIsLocked && requestNavigation) {
                        e.preventDefault();
                        requestNavigation('/workspace');
                      }
                    }}
                    className={cn(
                      'flex h-9 w-full items-center justify-center gap-2 rounded-md',
                      'bg-background/70 border-border/50 text-sidebar-foreground/70 border text-[13px] font-medium',
                      'hover:bg-background hover:border-border hover:text-sidebar-foreground transition-colors duration-100',
                      'group-data-[collapsible=icon]:border-border/60 group-data-[collapsible=icon]:bg-background group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:border group-data-[collapsible=icon]:px-0'
                    )}
                  >
                    <Plus size={14} className="text-sidebar-foreground/50 shrink-0" />
                    <span className="group-data-[collapsible=icon]:hidden">Nova Sessão</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Nova Sessão
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Nav principal */}
            <SidebarGroup className="p-0">
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {NAV_ROUTES.map((route) => (
                    <NavItem
                      key={route.href}
                      href={route.href}
                      icon={route.icon}
                      label={route.label}
                      active={isActive(pathname, route.href, route.exact)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
          {/* ── Fim zona primária ──────────────────────────────────────── */}

          {/* ── Zona secundária: histórico de sessões recentes ────────────
              Sem fundo especial — fica visivelmente mais leve que a zona
              primária, criando hierarquia por contraste. */}
          <SidebarGroup className="p-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="text-sidebar-foreground/30 px-1.5 pt-2 pb-1.5 text-[9.5px] font-semibold tracking-[0.12em] uppercase">
              Recentes
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {isLoading ? (
                  <RecentChatsSkeleton />
                ) : chats.length > 0 ? (
                  chats.map((chat) => (
                    <RecentChatItem
                      key={chat.id}
                      chat={chat}
                      active={isActive(pathname, `/workspace/chat/${chat.id}`)}
                      onShare={() => setShareDialogChatId(chat.id)}
                      onRename={(title) => rename(chat.id, title)}
                      onDelete={() => handleDelete(chat.id)}
                    />
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                    <div className="bg-sidebar-accent/60 flex size-9 items-center justify-center rounded-full">
                      <MessagesSquare size={16} className="text-sidebar-foreground/25" />
                    </div>
                    <p className="text-sidebar-foreground/30 text-[11px] leading-snug">
                      Nenhuma sessão ainda.
                      <br />
                      Inicie uma nova busca.
                    </p>
                  </div>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {/* ── Fim zona secundária ──────────────────────────────────── */}
        </SidebarContent>

        {/* ── Footer ── */}
        <SidebarFooter className="border-sidebar-border/60 border-t p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <UserMenuPopover />
        </SidebarFooter>
      </Sidebar>

      {shareDialogChatId && (
        <ShareDialog
          chatId={shareDialogChatId}
          open
          onOpenChange={(o) => {
            if (!o) setShareDialogChatId(null);
          }}
        />
      )}
    </>
  );
}

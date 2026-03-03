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
import { BookOpenText, PanelLeftClose, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn, isActive } from '@/lib/utils';
import { ShareDialog } from '@/components/ShareDialog';
import { useRecentChats } from '@/hooks/useRecentChats';
import { SIDEBAR_ICON_WIDTH, NAV_ROUTES } from '@/components/sidebar/sidebar.config';
import { NavItem } from '@/components/sidebar/NavItem';
import { RecentChatItem, RecentChatsSkeleton } from '@/components/sidebar/RecentChatItem';
import { SidebarExpandButton } from '@/components/sidebar/SidebarExpandButton';
import { UserMenuPopover } from '@/components/sidebar/UserMenuPopover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { state, toggleSidebar } = useSidebar();

  const { chats, isLoading, rename, remove } = useRecentChats(session?.user?.id, pathname);
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(null);

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
        <SidebarHeader className="border-sidebar-border/60 h-14 items-center justify-between border-b px-3">
          <div className="flex h-full w-full items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <Link href="/workspace" className="flex shrink-0 items-center gap-2">
              <div className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-90">
                <BookOpenText size={14} className="text-primary-foreground" />
              </div>
            </Link>
            <div className="flex min-w-0 flex-1 flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="text-sidebar-foreground truncate text-[13px] font-semibold tracking-tight">
                SOL O.L.A
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
        <SidebarContent className="gap-0 overflow-x-hidden px-2 py-2 group-data-[collapsible=icon]:px-0">
          {/* ── Zona primária: ação + nav principal ─────────────────────────
              Fundo levemente elevado para criar hierarquia visual clara.
              No modo colapsado (icon only) remove o padding lateral. */}
          <div className="bg-sidebar-accent/20 mb-1.5 rounded-lg p-1.5 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:px-0">
            {/* CTA — Nova Sessão */}
            <div className="pb-1 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pb-2">
              {/* open={undefined} quando collapsed = Radix gerencia; open={false} quando expanded = nunca mostra */}
              <Tooltip open={state === 'collapsed' ? undefined : false}>
                <TooltipTrigger asChild>
                  <Link
                    href="/workspace"
                    className={cn(
                      'flex h-8 w-full items-center justify-center gap-2 rounded-md',
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
                <SidebarMenu className="gap-0.5">
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
            <SidebarGroupLabel className="text-sidebar-foreground/30 px-1.5 pt-1 pb-1 text-[9.5px] font-semibold tracking-[0.12em] uppercase">
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
                  <p className="text-sidebar-foreground/25 px-2 py-2 text-[11px]">
                    Nenhuma sessão recente
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {/* ── Fim zona secundária ──────────────────────────────────── */}
        </SidebarContent>

        {/* ── Footer ── */}
        <SidebarFooter className="border-sidebar-border/60 border-t p-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <UserMenuPopover />
        </SidebarFooter>
      </Sidebar>

      {state === 'collapsed' && <SidebarExpandButton onExpand={toggleSidebar} />}

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

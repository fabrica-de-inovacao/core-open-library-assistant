'use client';

import { useState, useEffect } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Search, History, Settings, UserCircle, Sun, Moon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { getUserStats } from '@/server/actions/user';
import { useTheme } from '@/components/theme-provider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-border/50 border-b py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/workspace">
                {/* SOL como monograma — mais distintivo que ícone genérico */}
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-md shadow-sm">
                  <span className="font-mono text-[11px] font-black tracking-tighter">SOL</span>
                </div>
                <div className="flex min-w-0 flex-col gap-0 leading-none">
                  <span className="text-foreground truncate text-sm font-bold tracking-tight">
                    Open Library
                  </span>
                  <span className="text-muted-foreground font-mono text-[9px] font-medium tracking-[0.18em] uppercase">
                    SCBC
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pesquisa</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/workspace'}>
                  <Link href="/workspace">
                    <Search />
                    <span>Nova Busca</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/workspace/history')}>
                  <Link href="/workspace/history">
                    <History />
                    <span>Minhas Buscas</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/workspace/settings')}>
                  <Link href="/workspace/settings">
                    <Settings />
                    <span>Configurações</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={toggleTheme}
                  tooltip={resolvedTheme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                >
                  {resolvedTheme === 'dark' ? (
                    <Sun className="text-[oklch(0.72_0.16_72)]" />
                  ) : (
                    <Moon className="text-primary/60" />
                  )}
                  <span>{resolvedTheme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-border/50 border-t p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              isActive={pathname.startsWith('/workspace/profile')}
              className="h-12 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Link href="/workspace/profile">
                {session?.user?.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name || 'User Avatar'}
                    referrerPolicy="no-referrer"
                    className="border-border size-8 rounded-full border shadow-sm"
                  />
                ) : (
                  <UserCircle className="text-muted-foreground size-8" />
                )}
                <div className="flex min-w-0 flex-col gap-0.5 leading-none">
                  <span className="text-foreground max-w-35 truncate font-medium">
                    {session?.user?.name || 'Pesquisador'}
                  </span>
                  <span className="text-muted-foreground max-w-35 truncate text-xs">
                    {session?.user?.email || 'Ver perfil'}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Badge de versão — detalhe de produto profissional */}
        <div className="mt-1 flex items-center justify-between px-2 pb-1 group-data-[collapsible=icon]:hidden">
          <span className="text-muted-foreground/40 font-mono text-[9px] tracking-wider">
            v0.9-beta
          </span>
          <span className="text-muted-foreground/40 font-mono text-[9px] tracking-wider">
            SCBC · 2026
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

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
import { Search, History, Settings, UserCircle, Library, FileText, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { getUserStats } from '@/server/actions/user';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [stats, setStats] = useState({ totalSearches: 0, totalArticles: 0 });
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    if (isProfileOpen && session?.user) {
      getUserStats().then(setStats);
    }
  }, [isProfileOpen, session]);

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-border/50 border-b py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/workspace">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sky-500 text-white">
                  <Library className="size-5" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="text-foreground font-semibold tracking-tight">SOL Open</span>
                  <span className="text-muted-foreground -mt-1 text-[10px] font-medium tracking-wider uppercase">
                    Library Assistant
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
                <SidebarMenuButton asChild>
                  <Link href="/workspace/settings">
                    <Settings />
                    <span>Configurações</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-border/50 border-t p-4">
        <SidebarMenu>
          <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
            <DialogTrigger asChild>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  className="h-12 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
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
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="text-foreground max-w-[140px] truncate font-medium">
                      {session?.user?.name || 'Pesquisador'}
                    </span>
                    <span className="text-muted-foreground max-w-[140px] truncate text-xs">
                      {session?.user?.email || 'SBC Acadêmico'}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </DialogTrigger>

            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-center text-xl font-semibold tracking-tight">
                  Seu Perfil
                </DialogTitle>
              </DialogHeader>

              <div className="flex flex-col items-center gap-6 py-4">
                {/* Avatar Grande */}
                <div className="relative">
                  {session?.user?.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || 'User Avatar'}
                      referrerPolicy="no-referrer"
                      className="size-24 rounded-full border-4 border-white shadow-lg dark:border-slate-900"
                    />
                  ) : (
                    <UserCircle className="text-muted-foreground size-24" />
                  )}
                </div>

                {/* Info Text */}
                <div className="flex flex-col items-center gap-1 text-center">
                  <h3 className="text-foreground text-xl font-bold">
                    {session?.user?.name || 'Pesquisador Visitante'}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {session?.user?.email || 'Nenhum email vinculado'}
                  </p>
                </div>

                {/* Estatísticas (SciSpace Style Grid) */}
                <div className="grid w-full grid-cols-2 gap-4 pt-2">
                  <div className="flex flex-col items-center justify-center rounded-xl border border-sky-100 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/30 dark:bg-sky-900/10">
                    <Search className="mb-2 size-5 text-sky-500" />
                    <span className="text-2xl font-bold text-sky-700 dark:text-sky-400">
                      {stats.totalSearches}
                    </span>
                    <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      Buscas Feitas
                    </span>
                  </div>
                  <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-900/30 dark:bg-emerald-900/10">
                    <FileText className="mb-2 size-5 text-emerald-500" />
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                      {stats.totalArticles}
                    </span>
                    <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      Artigos Indx
                    </span>
                  </div>
                </div>

                {/* Logout Button */}
                <Button
                  variant="outline"
                  className="mt-4 w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                >
                  <LogOut className="mr-2 size-4" />
                  Sair da Conta
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

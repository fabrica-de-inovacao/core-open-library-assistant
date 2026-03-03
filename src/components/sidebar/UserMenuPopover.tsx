'use client';

import { useState } from 'react';
import { ChevronsUpDown, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { UserAvatar } from './UserAvatar';
import { SettingsModal } from './SettingsModal';

export function UserMenuPopover() {
  const { data: session } = useSession();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isDark = resolvedTheme === 'dark';
  const user = session?.user;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'group/trigger flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left',
              'group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
              'transition-colors duration-150',
              open ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
            )}
          >
            <UserAvatar
              src={user?.image}
              alt={user?.name ?? 'Avatar'}
              className="size-7"
              iconSize={16}
            />
            <div className="flex min-w-0 flex-1 flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="text-foreground truncate text-[12px] font-medium">
                {user?.name ?? 'Pesquisador'}
              </span>
              <span className="text-muted-foreground/60 truncate font-mono text-[9px]">
                {user?.email ?? ''}
              </span>
            </div>
            <ChevronsUpDown
              size={13}
              className={cn(
                'shrink-0 transition-colors duration-100 group-data-[collapsible=icon]:hidden',
                open
                  ? 'text-foreground/60'
                  : 'text-muted-foreground/40 group-hover/trigger:text-muted-foreground'
              )}
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="animate-in slide-in-from-bottom-2 fade-in-0 w-64 p-0 shadow-lg duration-150"
        >
          <div className="border-border/50 flex items-center gap-3 border-b px-4 py-3">
            <UserAvatar
              src={user?.image}
              alt={user?.name ?? 'Avatar'}
              className="size-9"
              iconSize={20}
            />
            <div className="flex min-w-0 flex-col leading-none">
              <span className="text-foreground truncate text-[13px] font-semibold">
                {user?.name ?? 'Pesquisador'}
              </span>
              <span className="text-muted-foreground/70 truncate font-mono text-[10px]">
                {user?.email ?? ''}
              </span>
            </div>
          </div>

          <div className="py-1.5">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="text-foreground/80 flex items-center gap-2.5 text-[13px]">
                {isDark ? (
                  <Moon size={15} className="text-muted-foreground" />
                ) : (
                  <Sun size={15} className="text-muted-foreground" />
                )}
                <span>Modo escuro</span>
              </div>
              <Switch
                checked={isDark}
                onCheckedChange={toggleTheme}
                className="scale-90"
                aria-label="Alternar tema"
              />
            </div>

            <button
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
              className="text-foreground/80 hover:bg-accent hover:text-foreground mx-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-100"
            >
              <Settings size={15} className="text-muted-foreground shrink-0" />
              Configurações
            </button>

            <div className="bg-border/40 mx-3 my-1 h-px" />

            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="text-destructive hover:bg-destructive/8 hover:text-destructive mx-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-100"
            >
              <LogOut size={15} className="shrink-0" />
              Sair da conta
            </button>
          </div>

          <div className="border-border/50 border-t px-4 py-2">
            <span className="text-muted-foreground/30 font-mono text-[8px] tracking-widest uppercase">
              SOL O.L.A · v0.9-beta · SCBC 2026
            </span>
          </div>
        </PopoverContent>
      </Popover>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

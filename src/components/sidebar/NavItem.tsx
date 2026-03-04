import Link from 'next/link';
import { SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}

export function NavItem({ href, icon, label, active }: NavItemProps) {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
      {/* open={undefined} quando collapsed = Radix gerencia; open={false} quando expanded = nunca mostra */}
      <Tooltip open={isCollapsed ? undefined : false}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              'group flex h-9 w-full items-center gap-3 rounded px-3 text-[13px]',
              'group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
              'transition-colors duration-100',
              active
                ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <span
              className={cn(
                'shrink-0 transition-colors duration-100',
                active
                  ? 'text-sidebar-foreground'
                  : 'text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70'
              )}
            >
              {icon}
            </span>
            <span className="group-data-[collapsible=icon]:hidden">{label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

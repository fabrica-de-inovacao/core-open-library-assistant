import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from 'next-auth/react';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <main className="bg-background flex min-h-screen w-full flex-col">{children}</main>
        </SidebarProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}

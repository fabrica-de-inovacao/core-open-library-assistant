import { Suspense } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from 'next-auth/react';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider>
        <SidebarProvider>
          {/* Suspense isola o acesso dinâmico a cookies (estado da sidebar) do shell estático PPR */}
          <Suspense fallback={<div style={{ width: '13rem' }} />}>
            <AppSidebar />
          </Suspense>
          {/* Suspense isola sub-rotas dinâmicas (connection()) do shell estático PPR */}
          <Suspense fallback={null}>
            <main className="bg-background flex min-h-screen w-full flex-col">{children}</main>
          </Suspense>
        </SidebarProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SessionProvider } from 'next-auth/react';
import { ActiveChatProvider } from '@/contexts/ActiveChatContext';

/**
 * Workspace é área autenticada — não deve ser indexada por buscadores.
 * O título é sobrescrito por cada sub-rota; o template herdado do root layout é mantido.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider>
        <ActiveChatProvider>
          <SidebarProvider className="h-svh overflow-hidden">
            {/* Suspense isola o acesso dinâmico a cookies (estado da sidebar) do shell estático PPR */}
            <Suspense fallback={<div style={{ width: '13rem' }} />}>
              <AppSidebar />
            </Suspense>
            {/* Suspense removido: o layout anterior (fallback={null}) mantinha a página
                antiga montada durante a transição, causando stale UI ao trocar de rota.
                As páginas já têm seus próprios Suspense boundaries. */}
            <NextTopLoader
              color="var(--primary)"
              height={2}
              showSpinner={false}
              shadow={false}
            />
            <main className="bg-background flex h-full w-full flex-col overflow-hidden">
              {children}
            </main>
          </SidebarProvider>
        </ActiveChatProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}

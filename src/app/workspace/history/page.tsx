import { History } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';

export default function HistoryPage() {
  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div className="bg-border h-4 w-px" />
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-sky-500" />
            <span className="text-foreground/80 text-sm font-semibold tracking-tight">
              Minhas Buscas
            </span>
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/10 ring-1 ring-sky-500/20">
            <History className="h-8 w-8 text-sky-500" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">Histórico de Pesquisas</h2>
          <p className="text-muted-foreground">
            As suas revisões sistemáticas salvas serão listadas aqui em breve. Estamos finalizando a
            galeria de visualização.
          </p>
        </div>
      </div>
    </div>
  );
}

import { auth, signOut } from '@/auth';
import { getUserStats } from '@/server/actions/user';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCircle, Search, FileText, LogOut, Mail, CalendarDays } from 'lucide-react';

// Botão de logout como Server Action — não requer componente client
async function LogOutAction() {
  'use server';
  await signOut({ redirectTo: '/login' });
}

export default async function ProfilePage() {
  const session = await auth();
  const stats = await getUserStats();

  const user = session?.user;

  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      {/* Header */}
      <header className="border-border bg-background flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <SidebarTrigger />
        <div className="bg-border h-4 w-px" />
        <div className="flex items-center gap-2">
          <UserCircle className="text-primary h-4 w-4" />
          <span className="text-foreground/80 text-sm font-semibold tracking-tight">
            Perfil e Conta
          </span>
        </div>
      </header>

      {/* Conteúdo */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6 pt-12">
        <div className="w-full max-w-lg space-y-6">
          {/* Card de identidade */}
          <Card className="overflow-hidden">
            <div className="from-primary/15 h-24 bg-linear-to-r to-violet-500/10" />
            <CardContent className="-mt-12 flex flex-col items-center gap-4 pb-6 text-center">
              {user?.image ? (
                <img
                  src={user.image}
                  alt={user.name ?? 'Avatar'}
                  referrerPolicy="no-referrer"
                  className="border-background size-24 rounded-full border-4 shadow-lg"
                />
              ) : (
                <div className="border-background bg-muted flex size-24 items-center justify-center rounded-full border-4 shadow-lg">
                  <UserCircle className="text-muted-foreground size-12" />
                </div>
              )}

              <div className="space-y-1">
                <h2 className="text-xl font-bold tracking-tight">
                  {user?.name ?? 'Pesquisador Visitante'}
                </h2>
                <div className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
                  <Mail className="size-3.5" />
                  {user?.email ?? 'Sem email vinculado'}
                </div>
              </div>

              <Badge variant="secondary" className="gap-1.5 text-xs font-medium">
                <CalendarDays className="size-3" />
                Membro SOL Open
              </Badge>
            </CardContent>
          </Card>

          {/* Cards de estatísticas */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-6">
                <Search className="text-primary size-6" />
                <span className="text-primary text-3xl font-bold">{stats.totalSearches}</span>
                <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Pesquisas Feitas
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-6">
                <FileText className="size-6 text-emerald-500" />
                <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {stats.totalArticles}
                </span>
                <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Artigos Indexados
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Ações da conta */}
          <Card>
            <CardContent className="py-4">
              <h3 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
                Conta
              </h3>
              <form action={LogOutAction}>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                >
                  <LogOut className="mr-2 size-4" />
                  Sair da Conta
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

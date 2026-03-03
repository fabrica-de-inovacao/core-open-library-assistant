import {
  History,
  Search,
  ExternalLink,
  BookOpen,
  Clock,
  CheckCircle2,
  Loader2,
  XCircle,
  FileText,
  ChevronDown,
  Download,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql, eq, desc, count } from 'drizzle-orm';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { searchQueries, articles, chatSessions } from '@/server/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueryStatus = 'proposed' | 'searching' | 'processing' | 'done' | 'failed';

interface HistoryRow {
  id: string;
  // Fase 1 (P-17): título human-readable da sessão (ou fallback para a query original)
  displayTitle: string;
  status: string;
  createdAt: Date;
  articleCount: number;
  // Fase 1 (P-01): chatId para navegar à sessão completa
  chatId: string | null;
}

// P-20: número de sessões por página
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const STATUS_CONFIG: Record<
  QueryStatus,
  { label: string; icon: React.ReactNode; variant: BadgeVariant }
> = {
  done: {
    label: 'Concluída',
    icon: <CheckCircle2 className="h-3 w-3" />,
    variant: 'default',
  },
  processing: {
    label: 'Processando',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    variant: 'secondary',
  },
  searching: {
    label: 'Buscando',
    icon: <Search className="h-3 w-3" />,
    variant: 'secondary',
  },
  proposed: {
    label: 'Proposta',
    icon: <FileText className="h-3 w-3" />,
    variant: 'outline',
  },
  failed: {
    label: 'Falhou',
    icon: <XCircle className="h-3 w-3" />,
    variant: 'destructive',
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as QueryStatus] ?? {
    label: status,
    icon: <Clock className="h-3 w-3" />,
    variant: 'outline' as BadgeVariant,
  };

  return (
    <Badge variant={config.variant} className="flex items-center gap-1 text-xs">
      {config.icon}
      {config.label}
    </Badge>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchHistory(
  userId: string,
  cursor?: string
): Promise<{ rows: HistoryRow[]; hasMore: boolean; nextCursor: string | null }> {
  // P-20: cursor-based pagination — busca PAGE_SIZE+1 para detectar página seguinte
  const cursorDate = cursor ? new Date(cursor) : null;

  // Fase 1 (P-01, P-16): busca chat_sessions do usuário, com contagem de artigos acumulada
  const sessionQuery = db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      createdAt: chatSessions.createdAt,
    })
    .from(chatSessions)
    .where(
      cursorDate
        ? sql`${chatSessions.userId} = ${userId} AND ${chatSessions.createdAt} < ${cursorDate}`
        : eq(chatSessions.userId, userId)
    )
    .orderBy(desc(chatSessions.createdAt))
    .limit(PAGE_SIZE + 1); // +1 para detectar se há mais

  const sessionRows = await sessionQuery;
  const hasMore = sessionRows.length > PAGE_SIZE;
  const pageRows = hasMore ? sessionRows.slice(0, PAGE_SIZE) : sessionRows;

  if (pageRows.length === 0 && !cursor) {
    // Retrocompat: mostra queries antigas sem chatId (criadas antes da Fase 1)
    const articleCounts = db
      .select({
        queryId: articles.queryId,
        count: sql<number>`cast(count(*) as integer)`.as('count'),
      })
      .from(articles)
      .groupBy(articles.queryId)
      .as('article_counts');

    const legacyRows = await db
      .select({
        id: searchQueries.id,
        originalQuery: searchQueries.originalQuery,
        status: searchQueries.status,
        createdAt: searchQueries.createdAt,
        articleCount: sql<number>`coalesce(${articleCounts.count}, 0)`.as('article_count'),
      })
      .from(searchQueries)
      .leftJoin(articleCounts, eq(searchQueries.id, articleCounts.queryId))
      .where(eq(searchQueries.userId, userId))
      .orderBy(desc(searchQueries.createdAt))
      .limit(50);

    return {
      rows: legacyRows.map((r) => ({
        id: r.id,
        displayTitle: r.originalQuery,
        status: r.status,
        createdAt: r.createdAt,
        articleCount: Number(r.articleCount),
        chatId: null,
      })),
      hasMore: false,
      nextCursor: null,
    };
  }

  // Para cada sessão, busca o status mais recente e contagem de artigos
  const results: HistoryRow[] = await Promise.all(
    pageRows.map(async (sess) => {
      // Busca a última query da sessão para obter título fallback e status
      const [latestQuery] = await db
        .select({
          originalQuery: searchQueries.originalQuery,
          status: searchQueries.status,
        })
        .from(searchQueries)
        .where(eq(searchQueries.chatId, sess.id))
        .orderBy(desc(searchQueries.createdAt))
        .limit(1);

      // Contagem total de artigos em todas as queries desta sessão
      const [{ total }] = await db
        .select({ total: count(articles.id) })
        .from(articles)
        .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
        .where(eq(searchQueries.chatId, sess.id));

      return {
        id: sess.id,
        displayTitle: sess.title ?? latestQuery?.originalQuery ?? 'Sessão sem título',
        status: latestQuery?.status ?? 'proposed',
        createdAt: sess.createdAt,
        articleCount: Number(total),
        chatId: sess.id,
      };
    })
  );

  const nextCursor =
    hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1]!.createdAt.toISOString() : null;

  return { rows: results, hasMore, nextCursor };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const params = await searchParams;
  const cursor = params?.cursor;
  const { rows: history, hasMore, nextCursor } = await fetchHistory(session.user.id, cursor);
  const isFirstPage = !cursor;

  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      {/* Header */}
      <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div className="bg-border h-4 w-px" />
          <div className="flex items-center gap-2">
            <History className="text-primary h-4 w-4" />
            <span className="text-foreground/80 text-sm font-semibold tracking-tight">
              Minhas Buscas
            </span>
          </div>
        </div>
        <span className="text-muted-foreground text-xs">
          {history.length} sessão{history.length !== 1 ? 'ões' : ''} encontrada
          {history.length !== 1 ? 's' : ''}
          {!isFirstPage ? ' (página seguinte)' : ''}
        </span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {history.length === 0 && isFirstPage ? (
          /* Empty state */
          <div className="flex h-full items-center justify-center">
            <div className="w-full max-w-md text-center">
              <div className="bg-primary/10 ring-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ring-1">
                <History className="text-primary h-8 w-8" />
              </div>
              <h2 className="mb-2 text-2xl font-semibold tracking-tight">Nenhuma busca ainda</h2>
              <p className="text-muted-foreground mb-6 text-sm">
                Suas revisões sistemáticas aparecerão aqui após a primeira pesquisa.
              </p>
              <Link
                href="/workspace"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
              >
                <Search className="h-4 w-4" />
                Iniciar nova pesquisa
              </Link>
            </div>
          </div>
        ) : (
          /* History list */
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {history.map((row) => (
              <div
                key={row.id}
                className="border-border bg-card hover:bg-accent/30 flex flex-col gap-3 rounded-lg border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={row.status} />
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Clock className="h-3 w-3" />
                      {formatDate(row.createdAt)}
                    </span>
                  </div>

                  {/* Fase 1 (P-17): título human-readable (chatSession.title ou fallback para query) */}
                  <p className="truncate text-sm leading-snug font-medium" title={row.displayTitle}>
                    {row.displayTitle}
                  </p>

                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <BookOpen className="h-3 w-3" />
                    {row.articleCount} artigo{row.articleCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* P-21: Botões de ação — Exportar BibTeX + Abrir */}
                <div className="flex shrink-0 items-center gap-2">
                  {/* P-21: Botão de exportação BibTeX para sessões com artigos */}
                  {row.chatId && row.articleCount > 0 && (
                    <a
                      href={`/api/export?chat_id=${row.chatId}&format=bibtex`}
                      download
                      className="border-border bg-background hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                      title="Exportar referências em BibTeX"
                    >
                      <Download className="h-3 w-3" />
                      BibTeX
                    </a>
                  )}

                  {/* Botão Abrir */}
                  {(row.status === 'done' ||
                    row.status === 'processing' ||
                    row.articleCount > 0) && (
                    <Link
                      href={
                        row.chatId
                          ? `/workspace/chat/${row.chatId}`
                          : `/workspace?query_id=${row.id}`
                      }
                      className="border-border bg-background hover:bg-accent hover:text-accent-foreground flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir
                    </Link>
                  )}
                </div>
              </div>
            ))}

            {/* P-20: Cursor pagination — Carregar mais sessões */}
            {hasMore && nextCursor && (
              <div className="flex justify-center pt-4 pb-2">
                <Link
                  href={`/workspace/history?cursor=${encodeURIComponent(nextCursor)}`}
                  className="border-border bg-background hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                >
                  <ChevronDown className="h-4 w-4" />
                  Carregar mais sessões
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { FlaskConical, Search, BookOpen, BarChart3, Unlock } from 'lucide-react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql, eq, desc, count } from 'drizzle-orm';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { searchQueries, articles, chatSessions } from '@/server/db/schema';
import { HistoryList } from '@/components/workspace/HistoryList';
import type { HistoryRowSerialized } from '@/components/workspace/HistoryList';

// ---------------------------------------------------------------------------
// Types (server-side — datas como Date, serializadas antes de passar ao cliente)
// ---------------------------------------------------------------------------

interface HistoryRow {
  id: string;
  displayTitle: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  articleCount: number;
  doneCount: number;
  tldrCount: number;
  openAccessCount: number;
  queryCount: number;
  chatId: string | null;
}

interface GlobalStats {
  totalSessions: number;
  totalArticles: number;
  totalOpenAccess: number;
}

// P-20: número de sessões por página (cursor-based)
const PAGE_SIZE = 20;

function serializeRow(r: HistoryRow): HistoryRowSerialized {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchGlobalStats(userId: string): Promise<GlobalStats> {
  const [sessionsResult] = await db
    .select({ total: count(chatSessions.id) })
    .from(chatSessions)
    .where(eq(chatSessions.userId, userId));

  const [articlesResult] = await db
    .select({
      total: count(articles.id),
      openAccess: sql<number>`cast(sum(case when ${articles.isOpenAccess} = true then 1 else 0 end) as integer)`,
    })
    .from(articles)
    .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
    .where(eq(searchQueries.userId, userId));

  return {
    totalSessions: Number(sessionsResult?.total ?? 0),
    totalArticles: Number(articlesResult?.total ?? 0),
    totalOpenAccess: Number(articlesResult?.openAccess ?? 0),
  };
}

async function fetchHistory(
  userId: string,
  cursor?: string
): Promise<{ rows: HistoryRow[]; hasMore: boolean; nextCursor: string | null }> {
  const cursorDate = cursor ? new Date(cursor) : null;

  const sessionQuery = db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(
      cursorDate
        ? sql`${chatSessions.userId} = ${userId} AND ${chatSessions.createdAt} < ${cursorDate}`
        : eq(chatSessions.userId, userId)
    )
    .orderBy(desc(chatSessions.createdAt))
    .limit(PAGE_SIZE + 1);

  const sessionRows = await sessionQuery;
  const hasMore = sessionRows.length > PAGE_SIZE;
  const pageRows = hasMore ? sessionRows.slice(0, PAGE_SIZE) : sessionRows;

  if (pageRows.length === 0 && !cursor) {
    // Retrocompat: queries antigas sem chatId
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
        updatedAt: r.createdAt,
        articleCount: Number(r.articleCount),
        doneCount: 0,
        tldrCount: 0,
        openAccessCount: 0,
        queryCount: 1,
        chatId: null,
      })),
      hasMore: false,
      nextCursor: null,
    };
  }

  const results: HistoryRow[] = await Promise.all(
    pageRows.map(async (sess) => {
      const [latestQuery] = await db
        .select({ originalQuery: searchQueries.originalQuery, status: searchQueries.status })
        .from(searchQueries)
        .where(eq(searchQueries.chatId, sess.id))
        .orderBy(desc(searchQueries.createdAt))
        .limit(1);

      const [stats] = await db
        .select({
          total: count(articles.id),
          done: sql<number>`cast(sum(case when ${articles.status} = 'done' then 1 else 0 end) as integer)`,
          tldr: sql<number>`cast(sum(case when ${articles.tldrContent} is not null then 1 else 0 end) as integer)`,
          openAccess: sql<number>`cast(sum(case when ${articles.isOpenAccess} = true then 1 else 0 end) as integer)`,
        })
        .from(articles)
        .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
        .where(eq(searchQueries.chatId, sess.id));

      const [{ qCount }] = await db
        .select({ qCount: count(searchQueries.id) })
        .from(searchQueries)
        .where(eq(searchQueries.chatId, sess.id));

      return {
        id: sess.id,
        displayTitle: sess.title ?? latestQuery?.originalQuery ?? 'Sessão sem título',
        status: latestQuery?.status ?? 'proposed',
        createdAt: sess.createdAt,
        updatedAt: sess.updatedAt,
        articleCount: Number(stats?.total ?? 0),
        doneCount: Number(stats?.done ?? 0),
        tldrCount: Number(stats?.tldr ?? 0),
        openAccessCount: Number(stats?.openAccess ?? 0),
        queryCount: Number(qCount ?? 0),
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
  if (!session?.user?.id) redirect('/login');

  const params = await searchParams;
  const cursor = params?.cursor;
  const isFirstPage = !cursor;

  const [{ rows: history, hasMore, nextCursor }, globalStats] = await Promise.all([
    fetchHistory(session.user.id, cursor),
    isFirstPage ? fetchGlobalStats(session.user.id) : Promise.resolve(null),
  ]);

  const serializedRows = history.map(serializeRow);
  const isEmpty = serializedRows.length === 0 && isFirstPage;

  return (
    <div className="bg-background text-foreground flex h-screen flex-col font-sans">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="bg-background/95 flex h-14 shrink-0 items-center gap-4 px-4 backdrop-blur-sm">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-md transition-colors md:hidden" />
        <div className="bg-border/40 h-4 w-px shrink-0" />

        <div className="flex shrink-0 items-center gap-2">
          <FlaskConical className="text-primary h-[15px] w-[15px]" />
          <span className="text-foreground text-sm font-semibold tracking-tight">
            Minhas Revisões
          </span>
        </div>

        {globalStats && globalStats.totalSessions > 0 && (
          <div className="hidden items-center gap-3 sm:flex">
            <div className="bg-border/40 h-3 w-px" />
            <span className="text-muted-foreground/55 flex items-center gap-1 text-[11px]">
              <BarChart3 className="h-3 w-3" />
              <span className="text-foreground/60 font-medium tabular-nums">
                {globalStats.totalSessions}
              </span>{' '}
              revisões
            </span>
            {globalStats.totalArticles > 0 && (
              <span className="text-muted-foreground/55 flex items-center gap-1 text-[11px]">
                <BookOpen className="h-3 w-3" />
                <span className="text-foreground/60 font-medium tabular-nums">
                  {globalStats.totalArticles}
                </span>{' '}
                artigos
              </span>
            )}
            {globalStats.totalOpenAccess > 0 && (
              <span className="text-muted-foreground/55 flex items-center gap-1 text-[11px]">
                <Unlock className="h-3 w-3" />
                <span className="text-foreground/60 font-medium tabular-nums">
                  {globalStats.totalOpenAccess}
                </span>{' '}
                open access
              </span>
            )}
          </div>
        )}

        <div className="ml-auto">
          <Link
            href="/workspace"
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
          >
            <Search className="h-3 w-3" />
            Nova revisão
          </Link>
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="w-full max-w-xs text-center">
              <div className="bg-primary/8 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
                <FlaskConical className="text-primary h-6 w-6" />
              </div>
              <h2 className="mb-2 text-[17px] font-semibold tracking-tight">
                Nenhuma revisão ainda
              </h2>
              <p className="text-muted-foreground mb-6 text-[13px] leading-relaxed">
                Inicie uma pesquisa e suas revisões sistemáticas aparecerão aqui.
              </p>
              <Link
                href="/workspace"
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
              >
                <Search className="h-4 w-4" />
                Iniciar pesquisa
              </Link>
            </div>
          </div>
        ) : (
          <HistoryList
            initialRows={serializedRows}
            initialHasMore={hasMore}
            initialNextCursor={nextCursor}
          />
        )}
      </div>
    </div>
  );
}

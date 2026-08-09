import { NextResponse } from 'next/server';
import { sql, and, eq, gte, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { llmUsageEvents, articles, searchQueries, chatSessions } from '@/server/db/schema';

/**
 * GET /api/usage/stats?scope=user|chat&chatId=...&period=today|week|month
 *
 * scope=user  → agrega todas as métricas do usuário dentro do período
 * scope=chat  → agrega métricas de um chat específico (ignora período, usa chatId)
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope') ?? 'user';
  const chatId = searchParams.get('chatId');
  const period = searchParams.get('period') ?? 'today'; // today | week | month

  // ── LLM Usage ───────────────────────────────────────────────────────────
  let usageRows: any[];

  if (scope === 'chat' && chatId) {
    // Escopo chat: usa requestId LIKE `${chatId}:%` (chat turn id pattern)
    usageRows = await db
      .select({
        events: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::bigint`,
        cachedTokens: sql<number>`coalesce(sum(${llmUsageEvents.cachedInputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::bigint`,
        costMicrousd: sql<number>`coalesce(sum(${llmUsageEvents.estimatedCostMicrousd}), 0)::bigint`,
        chatTurns: sql<number>`count(distinct ${llmUsageEvents.requestId})::int`,
      })
      .from(llmUsageEvents)
      .where(
        and(
          eq(llmUsageEvents.userId, userId),
          sql`${llmUsageEvents.requestId} like ${chatId + ':%'}`
        )
      );
  } else {
    // Escopo usuário: filtra por período
    const since =
      period === 'month'
        ? sql`now() - interval '30 days'`
        : period === 'week'
          ? sql`now() - interval '7 days'`
          : sql`date_trunc('day', now())`;

    usageRows = await db
      .select({
        events: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::bigint`,
        cachedTokens: sql<number>`coalesce(sum(${llmUsageEvents.cachedInputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::bigint`,
        costMicrousd: sql<number>`coalesce(sum(${llmUsageEvents.estimatedCostMicrousd}), 0)::bigint`,
        chatTurns: sql<number>`count(distinct ${llmUsageEvents.requestId})::int`,
      })
      .from(llmUsageEvents)
      .where(
        and(
          eq(llmUsageEvents.userId, userId),
          gte(llmUsageEvents.createdAt, since)
        )
      );
  }

  const u = usageRows[0] ?? {};

  // ── Breakdown por task ────────────────────────────────────────────────
  const taskSince =
    scope === 'chat' && chatId
      ? null
      : period === 'month'
        ? sql`now() - interval '30 days'`
        : period === 'week'
          ? sql`now() - interval '7 days'`
          : sql`date_trunc('day', now())`;

  const taskWhere = scope === 'chat' && chatId
    ? and(eq(llmUsageEvents.userId, userId), sql`${llmUsageEvents.requestId} like ${chatId + ':%'}`)
    : and(eq(llmUsageEvents.userId, userId), gte(llmUsageEvents.createdAt, taskSince!));

  const taskRows = await db
    .select({
      task: llmUsageEvents.task,
      events: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::bigint`,
      costMicrousd: sql<number>`coalesce(sum(${llmUsageEvents.estimatedCostMicrousd}), 0)::bigint`,
    })
    .from(llmUsageEvents)
    .where(taskWhere)
    .groupBy(llmUsageEvents.task)
    .orderBy(desc(sql`sum(${llmUsageEvents.estimatedCostMicrousd})`));

  // ── Breakdown por modelo ───────────────────────────────────────────────
  const modelRows = await db
    .select({
      model: llmUsageEvents.model,
      provider: llmUsageEvents.provider,
      events: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::bigint`,
      costMicrousd: sql<number>`coalesce(sum(${llmUsageEvents.estimatedCostMicrousd}), 0)::bigint`,
    })
    .from(llmUsageEvents)
    .where(taskWhere)
    .groupBy(llmUsageEvents.model, llmUsageEvents.provider)
    .orderBy(desc(sql`sum(${llmUsageEvents.estimatedCostMicrousd})`));

  // ── Acervo (artigos) ──────────────────────────────────────────────────
  // Join articles → searchQueries → chatSessions para filtrar por user_id.
  // scope=chat: filtra por chatId via searchQueries.chatId.
  let acervoRows: any[];
  if (scope === 'chat' && chatId) {
    acervoRows = await db
      .select({
        done: sql<number>`count(*) filter (where ${articles.status} = 'done')::int`,
        abstract: sql<number>`count(*) filter (where ${articles.status} = 'abstract_only')::int`,
        failed: sql<number>`count(*) filter (where ${articles.status} = 'failed')::int`,
        pending: sql<number>`count(*) filter (where ${articles.status} in ('pending', 'extracting', 'llm_processing'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(articles)
      .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
      .where(eq(searchQueries.chatId, chatId));
  } else {
    acervoRows = await db
      .select({
        done: sql<number>`count(*) filter (where ${articles.status} = 'done')::int`,
        abstract: sql<number>`count(*) filter (where ${articles.status} = 'abstract_only')::int`,
        failed: sql<number>`count(*) filter (where ${articles.status} = 'failed')::int`,
        pending: sql<number>`count(*) filter (where ${articles.status} in ('pending', 'extracting', 'llm_processing'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(articles)
      .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
      .innerJoin(chatSessions, eq(searchQueries.chatId, chatSessions.id))
      .where(eq(chatSessions.userId, userId));
  }
  const a = acervoRows[0] ?? {};

  // ── Contagem de buscas ─────────────────────────────────────────────────
  let searches: number;
  if (scope === 'chat' && chatId) {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(searchQueries)
      .where(eq(searchQueries.chatId, chatId));
    searches = r[0]?.count ?? 0;
  } else {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(searchQueries)
      .innerJoin(chatSessions, eq(searchQueries.chatId, chatSessions.id))
      .where(eq(chatSessions.userId, userId));
    searches = r[0]?.count ?? 0;
  }

  return NextResponse.json({
    scope,
    period: scope === 'chat' ? null : period,
    usage: {
      events: Number(u.events ?? 0),
      inputTokens: Number(u.inputTokens ?? 0),
      cachedTokens: Number(u.cachedTokens ?? 0),
      outputTokens: Number(u.outputTokens ?? 0),
      totalTokens:
        Number(u.inputTokens ?? 0) +
        Number(u.outputTokens ?? 0),
      costMicrousd: Number(u.costMicrousd ?? 0),
      chatTurns: Number(u.chatTurns ?? 0),
    },
    byTask: taskRows.map((r: any) => ({
      task: r.task,
      events: Number(r.events),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costMicrousd: Number(r.costMicrousd),
    })),
    byModel: modelRows.map((r: any) => ({
      model: r.model,
      provider: r.provider,
      events: Number(r.events),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costMicrousd: Number(r.costMicrousd),
    })),
    acervo: {
      done: Number(a.done ?? 0),
      abstract: Number(a.abstract ?? 0),
      failed: Number(a.failed ?? 0),
      pending: Number(a.pending ?? 0),
      total: Number(a.total ?? 0),
    },
    searches,
  });
}

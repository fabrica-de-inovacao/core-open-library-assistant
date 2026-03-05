/**
 * POST /api/add-by-doi
 * Adiciona um artigo ao acervo a partir do seu DOI, consultando a API CrossRef
 * para obter os metadados. Enfileira TL;DR + embedding via Inngest.
 *
 * Body (JSON):
 *   doi    — DOI do artigo (ex: "10.1234/exemplo.2024")
 *   chatId — UUID da sessão de chat activa
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { chatSessions, searchQueries, articles } from '@/server/db/schema';
import { inngest } from '@/server/inngest/client';
import { CrossRefResponseSchema } from '@/lib/schemas/crossref';
import { logger } from '@/lib/logger';

// Regex permissivo para validação básica de DOI (10.xxxx/qualquer-coisa)
const DOI_REGEX = /^10\.\d{4,}(\.\d+)*\/\S+$/;

export async function POST(req: NextRequest) {
  // Autenticação
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const userId = session.user.id;

  // Parse JSON
  let body: { doi?: string; chatId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Normaliza: aceita URL completa (https://doi.org/10.xxx) ou DOI nu
  const doi = body.doi
    ?.trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();
  const chatId = body.chatId?.trim();

  if (!doi || !DOI_REGEX.test(doi)) {
    return NextResponse.json(
      { error: 'Formato de DOI inválido (ex: 10.1234/exemplo.2024)' },
      { status: 400 }
    );
  }
  if (!chatId) {
    return NextResponse.json({ error: 'chatId obrigatório' }, { status: 400 });
  }

  // ── 1. Consultar CrossRef ─────────────────────────────────────────────────
  let workTitle = doi; // fallback
  let abstract: string | null = null;
  let authors: string | null = null;
  let publicationYear: number | null = null;
  let publisher: string | null = null;
  let keywords: string | null = null;
  let sourceName: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const crossRefRes = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { 'User-Agent': 'SOLAssistant/1.0 (mailto:dev@example.com)' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!crossRefRes.ok) {
      return NextResponse.json(
        { error: `DOI não encontrado na CrossRef (HTTP ${crossRefRes.status})` },
        { status: 404 }
      );
    }

    const rawData = await crossRefRes.json();
    const parsed = CrossRefResponseSchema.safeParse(rawData);

    if (!parsed.success || parsed.data.status !== 'ok' || !parsed.data.message) {
      return NextResponse.json({ error: 'Resposta inesperada da CrossRef' }, { status: 502 });
    }

    const work = parsed.data.message;

    // Título
    const titleArr = work.title ?? [];
    if (titleArr.length > 0) workTitle = titleArr[0];

    // Abstract — remove tags JATS residuais
    if (work.abstract) {
      abstract = work.abstract.replace(/<\/?jats:[^>]+>/g, '').trim() || null;
    }

    // Autores
    if (work.author && work.author.length > 0) {
      authors = work.author.map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ');
    }

    // Ano de publicação
    const dateArr =
      work['published-print']?.['date-parts']?.[0] ?? work['published-online']?.['date-parts']?.[0];
    if (dateArr?.[0]) publicationYear = dateArr[0];

    publisher = work.publisher ?? null;
    sourceName = work['container-title']?.[0] ?? null;
    keywords = [...(work.keyword ?? []), ...(work.subject ?? [])].join(', ') || null;
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    logger.error(`[add-by-doi] CrossRef ${isAbort ? 'timeout' : 'erro'}:`, err);
    return NextResponse.json(
      { error: isAbort ? 'CrossRef demorou muito (timeout)' : 'Falha ao consultar CrossRef' },
      { status: 503 }
    );
  }

  // ── 2. Garantir que a chat_session existe (pode ser DOI antes do 1º envio) ──
  await db.insert(chatSessions).values({ id: chatId, userId }).onConflictDoNothing();

  // ── 3. Criar searchQuery ──────────────────────────────────────────────────
  const [query] = await db
    .insert(searchQueries)
    .values({
      chatId,
      userId,
      originalQuery: workTitle,
      status: 'done',
    })
    .returning({ id: searchQueries.id });

  // ── 3. Inserir artigo ─────────────────────────────────────────────────────
  // markdownContent = o abstract (base para geração de TL;DR pelo Inngest)
  const markdownContent = abstract
    ? `# ${workTitle}\n\n**Resumo do autor:**\n\n${abstract}`
    : `# ${workTitle}\n\n*Sem abstract disponível via CrossRef.*`;

  const syntheticUrl = `user:doi:${query.id}:${encodeURIComponent(doi)}`;

  const [article] = await db
    .insert(articles)
    .values({
      queryId: query.id,
      title: workTitle,
      doi,
      authors: authors ?? undefined,
      publicationYear: publicationYear ?? undefined,
      sourceName: sourceName ?? 'Documento via DOI',
      publisher: publisher ?? undefined,
      keywords: keywords ?? undefined,
      abstract: abstract ?? undefined,
      originalUrl: syntheticUrl,
      status: 'llm_processing', // Inngest gera TL;DR a partir do abstract
      markdownContent,
      metadataSource: 'user_doi',
    })
    .returning({ id: articles.id, title: articles.title });

  // ── 4. Enfileirar Inngest ─────────────────────────────────────────────────
  await inngest.send({
    name: 'app/process.articles.batch',
    data: {
      query_id: query.id,
      article_ids: [article.id],
      user_id: userId,
    },
  });

  logger.info(
    `[add-by-doi] ✅ Artigo inserido | doi=${doi} | id=${article.id} | query=${query.id}`
  );

  return NextResponse.json({
    success: true,
    articleId: article.id,
    queryId: query.id,
    title: article.title,
  });
}

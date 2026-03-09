/**
 * POST /api/upload-pdf
 * Recebe um PDF do utilizador (multipart/form-data), extrai o texto via
 * Python Worker, insere no acervo marcado como 'user_upload' e enfileira
 * o TL;DR + embedding via Inngest.
 *
 * Body (FormData):
 *   file   — PDF file
 *   chatId — UUID da sessão de chat activa
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { chatSessions, searchQueries, articles } from '@/server/db/schema';
import { inngest } from '@/server/inngest/client';
import { logger } from '@/lib/logger';

const WORKER_BASE = process.env.PYTHON_WORKER_URL ?? 'http://127.0.0.1:8000';

export async function POST(req: NextRequest) {
  // Autenticação
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const userId = session.user.id;

  // Parse multipart
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Payload inválido (esperado multipart/form-data)' },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  const chatId = formData.get('chatId') as string | null;

  if (!file || file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'Arquivo PDF obrigatório (application/pdf)' },
      { status: 400 }
    );
  }
  if (!chatId) {
    return NextResponse.json({ error: 'chatId obrigatório' }, { status: 400 });
  }

  const filename = file.name ?? 'documento.pdf';
  const titleFromFilename = filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

  // ── 1. Encaminhar para o Worker ──────────────────────────────────────────
  const workerForm = new FormData();
  workerForm.append('file', file, filename);

  let extractedMarkdown = '';
  try {
    const workerRes = await fetch(`${WORKER_BASE}/extract-upload`, {
      method: 'POST',
      headers: { 'X-Worker-Token': process.env.WORKER_API_KEY ?? '' },
      body: workerForm,
    });

    if (!workerRes.ok) {
      const err = await workerRes.text();
      logger.error(`[upload-pdf] Worker error ${workerRes.status}: ${err}`);
      return NextResponse.json({ error: 'Falha na extração do PDF pelo worker' }, { status: 502 });
    }

    const data = (await workerRes.json()) as {
      success: boolean;
      content_markdown?: string;
    };

    if (!data.success || !data.content_markdown?.trim()) {
      return NextResponse.json(
        { error: 'PDF sem conteúdo extraível (scaneado sem OCR ou protegido)' },
        { status: 422 }
      );
    }

    extractedMarkdown = data.content_markdown;
  } catch (err) {
    logger.error('[upload-pdf] Worker unreachable:', err);
    return NextResponse.json({ error: 'Worker indisponível' }, { status: 503 });
  }

  // ── 2. Garantir que a chat_session existe (pode ser upload antes do 1º envio) ──
  await db.insert(chatSessions).values({ id: chatId, userId }).onConflictDoNothing();

  // ── 3. Criar searchQuery para agrupar uploads desta sessão ────────────────
  // Uma query por upload — fica visível na QueryHistoryBar com o nome do arquivo.
  const [query] = await db
    .insert(searchQueries)
    .values({
      chatId,
      userId,
      originalQuery: titleFromFilename,
      status: 'done', // não há busca a efectuar — já temos o conteúdo
    })
    .returning({ id: searchQueries.id });

  // ── 3. Inserir artigo com markdown pré-preenchido ─────────────────────────
  // originalUrl sintético para satisfazer NOT NULL + unique index por query
  const syntheticUrl = `user:upload:${query.id}:${filename}`;

  const [article] = await db
    .insert(articles)
    .values({
      queryId: query.id,
      title: titleFromFilename,
      originalUrl: syntheticUrl,
      sourceName: 'Documento do utilizador',
      status: 'llm_processing', // pula extração, vai direto ao TL;DR
      markdownContent: extractedMarkdown,
      metadataSource: 'user_upload',
    })
    .returning({ id: articles.id, title: articles.title });

  // ── 4. Enfileirar Inngest para TL;DR + embedding ──────────────────────────
  await inngest.send({
    name: 'app/process.articles.batch',
    data: {
      query_id: query.id,
      article_ids: [article.id],
      user_id: userId,
    },
  });

  logger.info(
    `[upload-pdf] ✅ Artigo inserido | id=${article.id} | query=${query.id} | chars=${extractedMarkdown.length}`
  );

  return NextResponse.json({
    success: true,
    articleId: article.id,
    queryId: query.id,
    title: article.title,
  });
}

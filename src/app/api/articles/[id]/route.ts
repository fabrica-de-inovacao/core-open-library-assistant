/**
 * DELETE /api/articles/:id
 * Remove um artigo do acervo. Permitido apenas para artigos enviados pelo
 * próprio utilizador (metadataSource = 'user_upload' | 'user_doi') e desde
 * que a searchQuery associada pertença à sessão autenticada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { articles, searchQueries } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Autenticação
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const userId = session.user.id;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 });
  }

  // Busca o artigo com JOIN na searchQuery para verificar ownership
  const [row] = await db
    .select({
      articleId: articles.id,
      metadataSource: articles.metadataSource,
      queryUserId: searchQueries.userId,
    })
    .from(articles)
    .innerJoin(searchQueries, eq(articles.queryId, searchQueries.id))
    .where(eq(articles.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Artigo não encontrado' }, { status: 404 });
  }

  // Apenas artigos do próprio utilizador podem ser removidos via UI
  if (
    row.metadataSource !== 'user_upload' &&
    row.metadataSource !== 'user_doi' &&
    row.metadataSource !== 'crossref'
  ) {
    return NextResponse.json(
      { error: 'Apenas documentos enviados por você podem ser removidos' },
      { status: 403 }
    );
  }

  // Verificação de ownership
  if (row.queryUserId !== userId) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
  }

  await db.delete(articles).where(eq(articles.id, id));

  return NextResponse.json({ ok: true });
}

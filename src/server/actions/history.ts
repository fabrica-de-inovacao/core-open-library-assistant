'use server';

import { auth } from '@/auth';
import { db } from '@/server/db';
import { chatSessions, searchQueries } from '@/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertOwner(sessionIds: string[], userId: string): Promise<void> {
  const rows = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(inArray(chatSessions.id, sessionIds), eq(chatSessions.userId, userId)));

  if (rows.length !== sessionIds.length) {
    throw new Error('Unauthorized: uma ou mais sessões não pertencem a este utilizador.');
  }
}

// ---------------------------------------------------------------------------
// Ação: Excluir uma ou múltiplas sessões
// ---------------------------------------------------------------------------

export async function deleteSessions(
  sessionIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: 'Não autenticado.' };

    await assertOwner(sessionIds, session.user.id);

    // Busca queries associadas
    const queryRows = await db
      .select({ id: searchQueries.id })
      .from(searchQueries)
      .where(inArray(searchQueries.chatId, sessionIds));

    const queryIds = queryRows.map((r) => r.id);

    if (queryIds.length > 0) {
      // CASCADE: deletar searchQueries deleta articles via onDelete:'cascade'
      await db.delete(searchQueries).where(inArray(searchQueries.id, queryIds));
    }

    // CASCADE: deletar chatSessions deleta chatMessages via onDelete:'cascade'
    await db.delete(chatSessions).where(inArray(chatSessions.id, sessionIds));

    revalidatePath('/workspace/history');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Ação: Renomear sessão
// ---------------------------------------------------------------------------

export async function renameSession(
  sessionId: string,
  title: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: 'Não autenticado.' };

    await assertOwner([sessionId], session.user.id);

    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 200) {
      return { ok: false, error: 'Título inválido.' };
    }

    await db
      .update(chatSessions)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    revalidatePath('/workspace/history');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido.';
    return { ok: false, error: msg };
  }
}

/**
 * app/api/chat/feedback/route.ts
 * Fase C (Batch 3): persiste feedback pós-síntese (thumbs up/down) em
 * chat_sessions.synthesis_ratings — JSONB { [messageId]: 'up' | 'down' }.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { chatSessions } from '@/server/db/schema';
import { and, eq } from 'drizzle-orm';

const feedbackSchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().min(1),
  rating: z.enum(['up', 'down']).nullable(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Não autenticado.' }, { status: 401 });
    }
    const userId = session.user.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body inválido.' }, { status: 400 });
    }

    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { chatId, messageId, rating } = parsed.data;

    // Verifica propriedade e lê ratings atuais
    const [row] = await db
      .select({ synthesisRatings: chatSessions.synthesisRatings })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, chatId), eq(chatSessions.userId, userId)));

    if (!row) {
      return NextResponse.json(
        { success: false, error: 'Sessão não encontrada.' },
        { status: 404 }
      );
    }

    // Merge: remove entrada se rating é null (toggle off), caso contrário upsert
    const current = (row.synthesisRatings ?? {}) as Record<string, 'up' | 'down'>;
    if (rating === null) {
      delete current[messageId];
    } else {
      current[messageId] = rating;
    }

    await db
      .update(chatSessions)
      .set({ synthesisRatings: current })
      .where(eq(chatSessions.id, chatId));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Feedback API] Erro interno:', error);
    return NextResponse.json({ success: false, error: 'Erro interno.' }, { status: 500 });
  }
}

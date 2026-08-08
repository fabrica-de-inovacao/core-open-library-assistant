import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/server/db';
import { userLlmSettings } from '@/server/db/schema';

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await db
    .update(userLlmSettings)
    .set({ encryptedApiKey: null, apiKeyLast4: null, useOwnKey: false, updatedAt: new Date() })
    .where(eq(userLlmSettings.userId, session.user.id));

  return NextResponse.json({ ok: true });
}

import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserModel } from '@/server/llm/client';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const model = await getUserModel(session.user.id, 'tldr');
  const { text } = await generateText({
    model,
    prompt: 'Responda apenas: ok',
    abortSignal: AbortSignal.timeout(15_000),
  });

  return NextResponse.json({ ok: true, text });
}

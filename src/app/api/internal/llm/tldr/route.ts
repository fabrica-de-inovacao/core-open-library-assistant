import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { getUserModel } from '@/server/llm/client';

export async function POST(request: Request) {
  if (request.headers.get('x-worker-token') !== process.env.WORKER_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json()) as { user_id?: string; text: string; language?: string };
  const model = await getUserModel(body.user_id ?? null, 'tldr');
  const { text } = await generateText({
    model,
    system: `Você é um assistente acadêmico. Responda em ${body.language ?? 'pt-BR'}.`,
    prompt: body.text,
    abortSignal: AbortSignal.timeout(45_000),
  });
  return NextResponse.json({ text });
}

import { embed } from 'ai';
import { NextResponse } from 'next/server';
import { getUserEmbeddingModel } from '@/server/llm/client';

export async function POST(request: Request) {
  if (request.headers.get('x-worker-token') !== process.env.WORKER_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json()) as { user_id?: string; text: string };
  const model = await getUserEmbeddingModel(body.user_id ?? null);
  const { embedding } = await embed({ model, value: body.text });
  return NextResponse.json({ embedding });
}

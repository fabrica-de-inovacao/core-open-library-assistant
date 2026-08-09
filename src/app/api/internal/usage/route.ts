import { NextResponse } from 'next/server';
import { recordUsage } from '@/server/llm/record-usage';

/**
 * Endpoint interno para o worker Python gravar eventos de uso de LLM.
 * Auth via X-Worker-Token (mesmo padrão dos endpoints /api/internal/llm/*).
 */
export async function POST(request: Request) {
  if (request.headers.get('x-worker-token') !== process.env.WORKER_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    user_id?: string | null;
    article_id?: string | null;
    provider?: string;
    model: string;
    task: string;
    prompt_tokens?: number;
    input_tokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
  };

  await recordUsage({
    userId: body.user_id ?? null,
    requestId: body.article_id ?? null,
    provider: body.provider,
    model: body.model,
    task: body.task,
    usage: {
      inputTokens: body.input_tokens ?? body.prompt_tokens ?? 0,
      outputTokens: body.output_tokens ?? body.completion_tokens ?? 0,
      cachedInputTokens: body.cached_tokens ?? 0,
    },
  });

  return NextResponse.json({ ok: true });
}

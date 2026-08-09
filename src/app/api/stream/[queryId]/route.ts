import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { createRedisSubscriber } from '@/lib/redis';
import { db } from '@/server/db';
import { searchQueries } from '@/server/db/schema';

export async function GET(request: Request, { params }: { params: Promise<{ queryId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 });

  const { queryId } = await params;
  const [query] = await db
    .select({ id: searchQueries.id, userId: searchQueries.userId, revision: searchQueries.revision })
    .from(searchQueries)
    .where(eq(searchQueries.id, queryId))
    .limit(1);

  if (!query || (query.userId && query.userId !== session.user.id)) {
    return new Response('Not Found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const subscriber = createRedisSubscriber();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const enqueue = (data: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(data);
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscriber.removeAllListeners();
        void (async () => {
          try {
            await subscriber.unsubscribe();
          } finally {
            await subscriber.quit();
          }
        })().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // O cliente pode fechar o stream antes do teardown terminar.
        }
      };

      enqueue(
        encoder.encode(`id: ${query.revision}\nevent: run.updated\ndata: {"query_id":"${queryId}","revision":${query.revision}}\n\n`)
      );
      const heartbeat = setInterval(() => {
        enqueue(encoder.encode(': heartbeat\n\n'));
      }, 30_000);

      subscriber.subscribe(`query:${queryId}`, (err) => {
        if (err && !closed) {
          closed = true;
          clearInterval(heartbeat);
          controller.error(err);
        }
      });

      subscriber.on('message', async (_channel, message) => {
        if (closed) return;
        const [current] = await db
          .select({ revision: searchQueries.revision })
          .from(searchQueries)
          .where(eq(searchQueries.id, queryId))
          .limit(1);
        if (closed) return;
        const revision = current?.revision ?? 0;
        let cause = 'state.changed';
        try {
          cause = JSON.parse(message).type ?? cause;
        } catch {
          // Snapshot continua autoritativo mesmo se o payload legado estiver malformado.
        }
        enqueue(
          encoder.encode(`id: ${revision}\nevent: run.updated\ndata: ${JSON.stringify({ query_id: queryId, revision, cause })}\n\n`)
        );
      });

      subscriber.on('error', (err) => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        controller.error(err);
      });

      request.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

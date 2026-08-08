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
    .select({ id: searchQueries.id, userId: searchQueries.userId })
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
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 30_000);

      subscriber.subscribe(`query:${queryId}`, (err) => {
        if (err) controller.error(err);
      });

      subscriber.on('message', (_channel, message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });

      subscriber.on('error', (err) => {
        clearInterval(heartbeat);
        controller.error(err);
      });

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        void subscriber.unsubscribe();
        void subscriber.quit();
        controller.close();
      });
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

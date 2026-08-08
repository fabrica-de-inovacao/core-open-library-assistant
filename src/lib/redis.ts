import { Redis } from 'ioredis';

const globalForRedis = globalThis as unknown as { bullmqRedis?: Redis };

function createRedis() {
  return new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export const bullmqRedis = globalForRedis.bullmqRedis ?? createRedis();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.bullmqRedis = bullmqRedis;
}

export function createRedisSubscriber() {
  return new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

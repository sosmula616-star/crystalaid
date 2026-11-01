import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Db } from '@crystalaid/database';

const CHECK_TIMEOUT_MS = 2000;

function within<T>(work: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timed out')), CHECK_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(work), timeout]).finally(() => clearTimeout(timer));
}

const succeeds = (check: () => PromiseLike<unknown>) =>
  within(Promise.resolve().then(check)).then(
    () => true,
    () => false,
  );

/**
 * PostgreSQL down: 503. Redis down: the API still serves reads, so 200 with `degraded`.
 * Each check has its own 2 second limit, so the endpoint cannot hang.
 */
export function registerHealth(app: FastifyInstance, deps: { db: Db; redis: Redis }): void {
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      succeeds(() => deps.db.execute(sql`select 1`)),
      succeeds(() => deps.redis.ping()),
    ]);
    if (!dbOk) return reply.status(503).send({ status: 'degraded' });
    return { status: redisOk ? 'ok' : 'degraded' };
  });
}

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '@crystalaid/contracts';

export const READ_LIMIT = 120;
export const WRITE_LIMIT = 30;
export const LOGIN_LIMIT = 10;

const isRead = (request: FastifyRequest) => request.method === 'GET' || request.method === 'HEAD';

/**
 * Limits per minute, counted in Redis. Authenticated requests are keyed by the staff user, the
 * rest by IP and route. The plugin's hook is appended after the route's own `onRequest` hooks,
 * so `requireStaff` has already set `request.actor` when the key is built. If Redis fails the
 * request is let through (`skipOnError`).
 */
export async function registerRateLimit(app: FastifyInstance, redis: Redis): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    redis,
    nameSpace: 'ratelimit:',
    skipOnError: true,
    timeWindow: '1 minute',
    max: (request) => (isRead(request) ? READ_LIMIT : WRITE_LIMIT),
    keyGenerator: (request) => {
      // `actor` is only set on routes that ran requireStaff.
      const actor = request.actor as FastifyRequest['actor'] | null;
      return actor
        ? `user:${isRead(request) ? 'read' : 'write'}:${actor.userId}`
        : `ip:${request.routeOptions.url ?? ''}:${request.ip}`;
    },
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many requests', 429),
  });
}

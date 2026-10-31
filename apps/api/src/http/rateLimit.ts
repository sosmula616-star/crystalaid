import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '@crystalaid/contracts';

export const READ_LIMIT = 120;
export const WRITE_LIMIT = 30;
export const LOGIN_LIMIT = 10;

/**
 * Rate-limit identity of a client address. IPv6 clients are grouped by /64, since one customer
 * usually holds a whole /64 and could otherwise rotate through addresses. IPv4-mapped IPv6
 * addresses count as the IPv4 address.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = ip.includes('::') && tail !== '' ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...first, ...Array<string>(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last]
    : first;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

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
    // Bot calls with the service token (`/internal/*`) are exempt. `requireService` sets the flag
    // only after the token matched, and a failed check ends the request before any limiting.
    allowList: (request) => request.serviceAuthenticated,
    timeWindow: '1 minute',
    max: (request) => (isRead(request) ? READ_LIMIT : WRITE_LIMIT),
    keyGenerator: (request) => {
      // `actor` is only set on routes that ran requireStaff.
      const actor = request.actor as FastifyRequest['actor'] | null;
      return actor
        ? `user:${isRead(request) ? 'read' : 'write'}:${actor.userId}`
        : `ip:${request.routeOptions.url ?? ''}:${clientKey(request.ip)}`;
    },
    errorResponseBuilder: () => new AppError('RATE_LIMITED', 'Too many requests', 429),
  });
}

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createDb } from '@crystalaid/database';
import { createShutdown } from './server.js';
import { withApp } from '../testing/harness.js';
import {
  BOT_TOKEN,
  CLIENT_SECRET,
  GUILD,
  JWT_SECRET,
  SERVICE_TOKEN,
  SUPPORT_ROLE,
  clearOwnedKeys,
  discordId,
  recordingLog,
  testRedis,
} from '../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

function deadRedis(): Redis {
  const client = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 1, retryStrategy: () => 100 });
  client.on('error', () => {});
  return client;
}

describe('/health', () => {
  it('is 200 ok when PostgreSQL and Redis work', () =>
    withApp({ redis }, async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    }));

  it('is 503 without the database', () =>
    withApp({ redis, db: createDb('postgres://u:p@127.0.0.1:1/none') }, async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'degraded' });
    }));

  it('is 200 degraded without Redis, and does not hang', async () => {
    const dead = deadRedis();
    try {
      await withApp({ redis: dead }, async ({ app }) => {
        const started = Date.now();
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'degraded' });
        expect(Date.now() - started).toBeLessThan(2500);
      });
    } finally {
      dead.disconnect();
    }
  });

  it('is not rate limited', () =>
    withApp({ redis }, async ({ app }) => {
      for (let i = 0; i < 125; i++) {
        expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      }
    }), 30_000);
});

describe('Redis outage', () => {
  it('lets requests through when the rate limiter cannot reach Redis (skipOnError)', async () => {
    const dead = deadRedis();
    try {
      await withApp({ redis: dead }, async ({ app, fake }) => {
        fake.addLogin({
          code: 'c1',
          user: { id: discordId(1), username: 'user1', avatar: null },
          instanceId: 'i1',
          guildId: GUILD,
          roles: [SUPPORT_ROLE],
        });
        const res = await app.inject({
          method: 'POST',
          url: '/auth/activity',
          payload: { code: 'c1', instanceId: 'i1' },
        });
        expect(res.statusCode).toBe(200);
      });
    } finally {
      dead.disconnect();
    }
  });
});

describe('errors', () => {
  it('turns an unhandled error into 500 INTERNAL without its text, and logs it with the requestId', () =>
    withApp(
      {
        redis,
        setup: (app) =>
          void app.get('/boom', async () => {
            throw new Error('password=hunter2 leaked');
          }),
      },
      async ({ app, logs }) => {
        const res = await app.inject({ method: 'GET', url: '/boom' });
        expect(res.statusCode).toBe(500);
        const { error } = res.json();
        expect(error.code).toBe('INTERNAL');
        expect(error.requestId).toEqual(expect.any(String));
        expect(JSON.stringify(res.json())).not.toContain('hunter2');
        expect(logs.join('')).toContain(error.requestId);
      },
    ));

  it('uses the common shape for unknown routes and malformed JSON', () =>
    withApp({ redis }, async ({ app }) => {
      let res = await app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
      res = await app.inject({
        method: 'POST',
        url: '/auth/activity',
        payload: '{"code":',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }));

  it('ignores a client supplied request id', () =>
    withApp({ redis }, async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/nope', headers: { 'x-request-id': 'forged' } });
      expect(res.json().error.requestId).not.toBe('forged');
    }));
});

describe('logging', () => {
  it('never logs the code, tokens or the client secret across a login', () =>
    withApp({ redis }, async ({ app, fake, logs }) => {
      fake.addLogin({
        code: 'oauth-code-abc123',
        user: { id: discordId(1), username: 'user1', avatar: null },
        instanceId: 'i1',
        guildId: GUILD,
        roles: [SUPPORT_ROLE],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/auth/activity',
        payload: { code: 'oauth-code-abc123', instanceId: 'i1' },
        headers: { authorization: 'Bearer header-token-xyz' },
      });
      const { sessionToken } = res.json();
      const text = logs.join('');
      expect(text.length).toBeGreaterThan(0);
      for (const secret of [
        'oauth-code-abc123',
        'access-oauth-code-abc123',
        'header-token-xyz',
        sessionToken,
        CLIENT_SECRET,
        BOT_TOKEN,
        JWT_SECRET,
        SERVICE_TOKEN,
      ]) {
        expect(text).not.toContain(secret);
      }
    }));

  it('keeps err.code readable while masking OAuth codes', () =>
    withApp({ redis }, async ({ app, logs }) => {
      app.log.error({ err: Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }) }, 'probe-err');
      app.log.info({ body: { code: 'oauth-secret-1' }, req: { body: { code: 'oauth-secret-2' } } }, 'probe-body');
      app.log.info({ code: 'oauth-secret-3' }, 'probe-top');
      const text = logs.join('');
      expect(text).toContain('ECONNREFUSED');
      for (const n of [1, 2, 3]) expect(text).not.toContain(`oauth-secret-${n}`);
    }));

  it('masks sensitive fields if they are logged', () =>
    withApp({ redis }, async ({ app, logs }) => {
      app.log.info(
        {
          code: 'c-1',
          access_token: 'at-1',
          client_secret: 'cs-1',
          sessionToken: 'st-1',
          discordAccessToken: 'dat-1',
          authorization: 'Bearer a-1',
          body: { code: 'c-2', access_token: 'at-2' },
          req: { headers: { authorization: 'Bearer a-2' } },
        },
        'probe',
      );
      const text = logs.join('');
      expect(text).toContain('probe');
      for (const value of ['c-1', 'at-1', 'cs-1', 'st-1', 'dat-1', 'a-1', 'c-2', 'at-2', 'a-2']) {
        expect(text).not.toContain(`"${value}"`);
        expect(text).not.toContain(`Bearer ${value}`);
      }
      expect(text).toContain('[redacted]');
    }));
});

describe('createShutdown', () => {
  it('closes everything once and logs a failure instead of rejecting', async () => {
    const log = recordingLog();
    const calls: string[] = [];
    const stop = createShutdown(
      {
        close: async () => void calls.push('app'),
        quitRedis: async () => {
          calls.push('redis');
          throw new Error('quit failed');
        },
        endDb: async () => void calls.push('db'),
      },
      log,
    );
    await expect(stop()).resolves.toBeUndefined();
    await stop();
    expect(calls).toEqual(['app', 'redis', 'db']);
    expect(log.errors).toContain('shutdown failed');
  });
});

describe('trust proxy', () => {
  const setup = (app: import('fastify').FastifyInstance) =>
    void app.get('/ip', async (request) => ({ ip: request.ip }));
  const ip = (app: import('fastify').FastifyInstance, remoteAddress: string, xff: string) =>
    app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: { 'x-forwarded-for': xff } });

  it('by default a client keeps its socket address whatever X-Forwarded-For says', () =>
    withApp({ redis, setup }, async ({ app }) => {
      expect((await ip(app, '10.0.0.9', '6.6.6.6')).json()).toEqual({ ip: '10.0.0.9' });
    }));

  it('takes X-Forwarded-For only from a peer in TRUSTED_PROXIES', () =>
    withApp({ redis, setup, env: { TRUSTED_PROXIES: ['10.0.0.9', '172.16.0.0/12'] } }, async ({ app }) => {
      expect((await ip(app, '10.0.0.9', '6.6.6.6')).json()).toEqual({ ip: '6.6.6.6' });
      expect((await ip(app, '172.20.1.1', '6.6.6.7')).json()).toEqual({ ip: '6.6.6.7' });
      expect((await ip(app, '10.0.0.10', '6.6.6.8')).json()).toEqual({ ip: '10.0.0.10' });
    }));
});

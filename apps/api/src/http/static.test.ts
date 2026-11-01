import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signSession } from '../services/session.js';
import { syncMember } from '../services/staff.js';
import { withApp, type AppContext } from '../testing/harness.js';
import {
  BOT_TOKEN,
  CLIENT_SECRET,
  JWT_SECRET,
  SERVICE_TOKEN,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  memberInput,
  testRedis,
} from '../test-helpers.js';
import { injectClientId, resolveInside } from './static.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));

const CLIENT = '300000000000000099';
let dir: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'crystalaid-static-'));
  writeFileSync(join(base, 'secret.txt'), 'top secret');
  dir = join(base, 'dist');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>',
  );
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'style-abc123.css'), 'body{}');
  writeFileSync(join(dir, 'robots.txt'), 'x');
});
afterAll(async () => {
  await redis.quit();
  rmSync(join(dir, '..'), { recursive: true, force: true });
});

const run = (fn: (ctx: AppContext) => Promise<void>) => withApp({ redis, activity: { dir, clientId: CLIENT } }, fn);

describe('static Activity', () => {
  it('serves index.html at / with the client id injected before the module script', () =>
    run(async ({ app }) => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      const html = res.body;
      expect(html).toContain(`<meta name="crystalaid-client-id" content="${CLIENT}">`);
      expect(html).not.toContain('<script>');
    }));

  it('serves hashed assets with content type and a long cache', () =>
    run(async ({ app }) => {
      const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      expect(js.statusCode).toBe(200);
      expect(js.headers['content-type']).toContain('text/javascript');
      expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(js.body).toBe('console.log(1)');
      const css = await app.inject({ method: 'GET', url: '/assets/style-abc123.css' });
      expect(css.headers['content-type']).toContain('text/css');
      const txt = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(txt.headers['cache-control']).not.toContain('immutable');
    }));

  it('falls back to index.html for client routes but not for missing files or API paths', () =>
    run(async ({ app }) => {
      const route = await app.inject({ method: 'GET', url: '/staff/42' });
      expect(route.statusCode).toBe(200);
      expect(route.body).toContain('id="root"');
      expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
      const miss = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(miss.statusCode).toBe(404);
      expect(miss.body).not.toContain('id="root"');
    }));

  it('rejects path traversal', () =>
    run(async ({ app }) => {
      for (const url of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%00', '/%zz']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
        expect(res.body, url).not.toContain('top secret');
      }
    }));

  it('resolveInside refuses to leave the root', () => {
    const root = resolve('/srv/dist');
    expect(resolveInside(root, '/a/b.js')).toBe(join(root, 'a', 'b.js'));
    expect(resolveInside(root, '/../x')).toBeNull();
    expect(resolveInside(root, '/a/..%2fb')).toBeNull();
    expect(resolveInside(root, '/a\\b')).toBeNull();
  });

  it('serves /api/me exactly like /me', () =>
    run(async (ctx) => {
      const staff = await syncMember({ db: ctx.db, config }, memberInput(1, [SUPPORT_ROLE]));
      const token = await signSession({ userId: staff!.userId, discordUserId: discordId(1) }, JWT_SECRET);
      const headers = { authorization: `Bearer ${token}` };
      const plain = await ctx.app.inject({ method: 'GET', url: '/me', headers });
      const prefixed = await ctx.app.inject({ method: 'GET', url: '/api/me', headers });
      expect(plain.statusCode).toBe(200);
      expect(prefixed.statusCode).toBe(200);
      expect(prefixed.json()).toEqual(plain.json());
      expect((await ctx.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    }));

  it('keeps /internal behind the service token, under /api too', () =>
    run(async (ctx) => {
      for (const url of ['/internal/tickets/due', '/api/internal/tickets/due']) {
        expect((await ctx.app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
        expect(
          (await ctx.app.inject({ method: 'GET', url, headers: { authorization: 'Bearer wrong' } })).statusCode,
          url,
        ).toBe(401);
      }
      const ok = await ctx.app.inject({
        method: 'GET',
        url: '/api/internal/tickets/due',
        headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
      });
      expect(ok.statusCode).not.toBe(401);
    }));

  it('reaches /auth/activity under /api (validation error, not a page)', () =>
    run(async ({ app }) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/activity', payload: {} });
      expect(res.statusCode).toBe(400);
    }));

  it('puts no secret in any served page', () =>
    run(async ({ app }) => {
      for (const url of ['/', '/staff', '/api/health']) {
        const res = await app.inject({ method: 'GET', url });
        for (const secret of [CLIENT_SECRET, BOT_TOKEN, JWT_SECRET, SERVICE_TOKEN]) {
          expect(res.body, url).not.toContain(secret);
        }
      }
    }));

  it('is not served when no dist is configured', () =>
    withApp({ redis }, async ({ app }) => {
      expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    }));
});

describe('injectClientId', () => {
  it('escapes anything that could leave the attribute', () => {
    const html = injectClientId('<head></head>', '"><b>&');
    expect(html).not.toContain('"><b>');
    expect(html).toContain('content="&quot;&gt;&lt;b&gt;&amp;"');
  });
});

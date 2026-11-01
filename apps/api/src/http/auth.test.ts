import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { ActivityAuthResponse } from '@crystalaid/contracts';
import { rolePermissions, staffMembers, users } from '@crystalaid/database';
import { USER_AGENT, createDiscordClient } from '../discord/client.js';
import { clientKey } from './rateLimit.js';
import { removeMember, syncMember } from '../services/staff.js';
import { signSession, verifySession } from '../services/session.js';
import { withApp } from '../testing/harness.js';
import {
  ADMIN_ROLE,
  CURATOR_ROLE,
  BOT_TOKEN,
  CLIENT_SECRET,
  GUILD,
  JWT_SECRET,
  SERVICE_TOKEN,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  memberInput,
  recordingLog,
  testEnv,
  testRedis,
} from '../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

const user = (n: number) => ({ id: discordId(n), username: `user${n}`, avatar: null });
const login = (code = 'c1', instanceId = 'i1') => ({ code, instanceId });

describe('POST /auth/activity', () => {
  it('logs a support member in, returns a session and creates the staff record', () =>
    withApp({ redis }, async ({ app, db, env, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [SUPPORT_ROLE] });
      const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      expect(res.statusCode).toBe(200);
      const body = ActivityAuthResponse.parse(res.json());
      expect(body.expiresIn).toBe(900);
      expect(body.discordAccessToken).toBe('access-c1');

      const [row] = await db
        .select({ id: users.id, discordId: users.discordId, level: staffMembers.level, status: staffMembers.status })
        .from(staffMembers)
        .innerJoin(users, eq(users.id, staffMembers.userId));
      expect(row).toMatchObject({ discordId: discordId(1), level: 'SUPPORT', status: 'active' });
      expect(await verifySession(body.sessionToken, env.JWT_SECRET)).toEqual({
        userId: row!.id,
        discordUserId: discordId(1),
      });
      // instance and member are read with the bot token, the user with their own
      const auth = (part: string) => fake.requests.find((r) => r.url.includes(part))?.authorization;
      expect(auth('/activity-instances/')).toMatch(/^Bot /);
      expect(auth('/members/')).toMatch(/^Bot /);
      expect(auth('/users/@me')).toBe('Bearer access-c1');
      // every call to Discord identifies the bot
      expect(fake.requests.length).toBeGreaterThanOrEqual(4);
      for (const r of fake.requests) expect(r.userAgent).toBe(USER_AGENT);
    }));

  it('puts no level or permissions into the token', () =>
    withApp({ redis }, async ({ app, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [ADMIN_ROLE] });
      const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      const token = (res.json() as { sessionToken: string }).sessionToken;
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
      expect(Object.keys(payload).sort()).toEqual(['discordUserId', 'exp', 'iat', 'userId']);
      expect(payload.exp - payload.iat).toBe(900);
    }));

  it('rejects an unknown instance, a foreign guild and a user outside the instance with INVALID_INSTANCE', () =>
    withApp({ redis }, async ({ app, fake }) => {
      // no instance registered at all: Discord answers 404
      fake.codes.set('c0', 'access-c0');
      fake.tokens.set('access-c0', user(1));
      let res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('c0', 'missing') });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('INVALID_INSTANCE');

      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: '999999999999999999', roles: [SUPPORT_ROLE] });
      res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('c1', 'i1') });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('INVALID_INSTANCE');

      fake.addLogin({
        code: 'c2',
        user: user(2),
        instanceId: 'i2',
        guildId: GUILD,
        roles: [SUPPORT_ROLE],
        instanceUsers: [discordId(3)],
      });
      res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('c2', 'i2') });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('INVALID_INSTANCE');
    }));

  it('answers GUILD_REQUIRED for a launch in direct messages or without a guild', () =>
    withApp({ redis }, async ({ app, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, kind: 'pc', roles: [SUPPORT_ROLE] });
      let res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('c1', 'i1') });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('GUILD_REQUIRED');

      fake.addLogin({ code: 'c2', user: user(2), instanceId: 'i2', guildId: null });
      res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('c2', 'i2') });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('GUILD_REQUIRED');
    }));

  it('answers NOT_STAFF for no branch roles, a curator without support, and a non-member', () =>
    withApp({ redis }, async ({ app, db, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: ['100000000000000099'] });
      fake.addLogin({ code: 'c2', user: user(2), instanceId: 'i2', guildId: GUILD, roles: [CURATOR_ROLE] });
      fake.addLogin({ code: 'c3', user: user(3), instanceId: 'i3', guildId: GUILD, roles: null });
      for (const n of [1, 2, 3]) {
        const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login(`c${n}`, `i${n}`) });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('NOT_STAFF');
        // only the curator without the support role is told what is missing
        expect(/support role is missing/.test(res.json().error.message)).toBe(n === 2);
        expect(res.json().error.reason).toBe(n === 2 ? 'support_role_missing' : 'not_in_branch');
      }
      expect(await db.select().from(staffMembers)).toHaveLength(0);
    }));

  it('answers NOT_STAFF and deactivates a member who lost the roles', () =>
    withApp({ redis }, async ({ app, db, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [SUPPORT_ROLE] });
      expect((await app.inject({ method: 'POST', url: '/auth/activity', payload: login() })).statusCode).toBe(200);
      fake.members.set(`${GUILD}:${discordId(1)}`, []);
      const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_STAFF');
      const [row] = await db.select().from(staffMembers);
      expect(row!.status).toBe('inactive');
    }));

  it('rejects an invalid body with VALIDATION_ERROR and a bad code with UNAUTHORIZED', () =>
    withApp({ redis }, async ({ app }) => {
      let res = await app.inject({ method: 'POST', url: '/auth/activity', payload: { code: 'x' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login('nope') });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }));

  const badLogin = (app: import('fastify').FastifyInstance, remoteAddress: string, xff?: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/activity',
      payload: login('bad'),
      remoteAddress,
      headers: xff ? { 'x-forwarded-for': xff } : {},
    });

  it('limits logins to 10 per minute per IP', () =>
    withApp({ redis }, async ({ app }) => {
      for (let i = 0; i < 10; i++) expect((await badLogin(app, '10.0.0.1')).statusCode).toBe(401);
      const limited = await badLogin(app, '10.0.0.1');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect((await badLogin(app, '10.0.0.2')).statusCode).toBe(401);
    }));

  it('ignores X-Forwarded-For from a direct client: rotating values still hit the limit', () =>
    withApp({ redis }, async ({ app }) => {
      for (let i = 0; i < 10; i++) {
        expect((await badLogin(app, '10.0.0.1', `7.7.7.${i}`)).statusCode).toBe(401);
      }
      expect((await badLogin(app, '10.0.0.1', '7.7.7.99')).statusCode).toBe(429);
    }));

  it('honours X-Forwarded-For from a peer in TRUSTED_PROXIES', () =>
    withApp({ redis, env: { TRUSTED_PROXIES: ['10.0.0.0/24'] } }, async ({ app }) => {
      for (let i = 0; i < 10; i++) expect((await badLogin(app, '10.0.0.5', '7.7.7.1')).statusCode).toBe(401);
      expect((await badLogin(app, '10.0.0.5', '7.7.7.1')).statusCode).toBe(429);
      // another client behind the same proxy has its own budget
      expect((await badLogin(app, '10.0.0.5', '7.7.7.2')).statusCode).toBe(401);
      // a peer outside the list cannot choose its address
      for (let i = 0; i < 10; i++) expect((await badLogin(app, '192.168.9.9', `8.8.8.${i}`)).statusCode).toBe(401);
      expect((await badLogin(app, '192.168.9.9', '8.8.8.200')).statusCode).toBe(429);
    }));

  it('counts one IPv6 /64 as one client', () =>
    withApp({ redis }, async ({ app }) => {
      for (let i = 0; i < 10; i++) {
        expect((await badLogin(app, `2001:db8:0:1::${i + 1}`)).statusCode).toBe(401);
      }
      expect((await badLogin(app, '2001:db8:0:1:ffff::9')).statusCode).toBe(429);
      expect((await badLogin(app, '2001:db8:0:2::1')).statusCode).toBe(401);
    }));

  it('clientKey keeps IPv4, maps IPv4-in-IPv6 and truncates IPv6 to /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:0:1::5')).toBe('2001:0db8:0000:0001::/64');
    expect(clientKey('2001:DB8:0:1:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:0000:0001::/64');
    expect(clientKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(clientKey('fe80::1')).toBe('fe80:0000:0000:0000::/64');
  });

  describe('a removal racing the login', () => {
    // The fake getMember applies the worker's removal while the login is reading the roles.
    for (const when of ['during', 'after'] as const) {
      it(`leaves no access when the worker applies it ${when === 'during' ? 'first' : 'after'}`, () => {
        const race = { at: undefined as Date | undefined, armed: false, dbRef: undefined as unknown };
        return withApp(
          {
            redis,
            discord: (env) => {
              const real = createDiscordClient(env);
              return {
                ...real,
                async getMember(guildId, userId) {
                  const member = await real.getMember(guildId, userId);
                  if (!race.armed) return member;
                  await new Promise((r) => setTimeout(r, 5));
                  race.at = new Date();
                  if (when === 'during') {
                    await removeMember({ db: race.dbRef as never, config }, userId, race.at);
                  }
                  // the login must not be able to share a millisecond with the removal
                  await new Promise((r) => setTimeout(r, 5));
                  return member;
                },
              };
            },
          },
          async ({ app, db, fake }) => {
            race.dbRef = db;
            fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [SUPPORT_ROLE] });
            expect((await app.inject({ method: 'POST', url: '/auth/activity', payload: login() })).statusCode).toBe(200);

            race.armed = true;
            const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
            if (when === 'during') {
              expect(res.statusCode).toBe(403);
              expect(res.json().error.code).toBe('NOT_STAFF');
            } else {
              expect(res.statusCode).toBe(200);
              await removeMember({ db, config }, discordId(1), race.at!);
            }
            const [row] = await db.select().from(staffMembers);
            expect(row!.status).toBe('inactive');
          },
        );
      });
    }
  });

  it('rejects a signed token without exp', async () => {
    const noExp = await new SignJWT({ userId: 'u', discordUserId: 'd' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .sign(new TextEncoder().encode(JWT_SECRET));
    await expect(verifySession(noExp, JWT_SECRET)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('Discord failures', () => {
  it.each([
    ['/oauth2/token', 429],
    ['/users/@me', 502],
    ['/activity-instances/', 429],
    ['/activity-instances/', 502],
    ['/members/', 503],
  ])('%s answering %i gives 503 DISCORD_UNAVAILABLE', (path, status) =>
    withApp({ redis }, async ({ app, fake }) => {
      fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [SUPPORT_ROLE] });
      fake.failWith(path, status);
      const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('DISCORD_UNAVAILABLE');
    }),
  );

  it('logs each failure as a warning with endpoint and status, and no secrets', () => {
    const warns: { message: string; data?: Record<string, unknown> }[] = [];
    const log = { info() {}, error() {}, warn: (message: string, data?: Record<string, unknown>) => void warns.push({ message, data }) };
    return withApp(
      { redis, discord: (env) => createDiscordClient(env, log) },
      async ({ app, fake }) => {
        fake.addLogin({ code: 'c1', user: user(1), instanceId: 'i1', guildId: GUILD, roles: [SUPPORT_ROLE] });
        fake.failWith('/activity-instances/', 502);
        const res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
        expect(res.statusCode).toBe(503);
        expect(warns).toEqual([
          { message: 'discord request failed', data: { endpoint: 'activity-instances', status: 502 } },
        ]);
        const text = JSON.stringify(warns);
        for (const secret of ['access-c1', 'c1', CLIENT_SECRET, BOT_TOKEN]) expect(text).not.toContain(secret);
      },
    );
  });

  it('treats a 401 from the token endpoint as our own misconfiguration, other 4xx as a bad code', () => {
    const warns: Record<string, unknown>[] = [];
    const log = { info() {}, error() {}, warn: (_m: string, d?: Record<string, unknown>) => void warns.push(d ?? {}) };
    return withApp({ redis, discord: (env) => createDiscordClient(env, log) }, async ({ app, fake }) => {
      fake.failWith('/oauth2/token', 401);
      let res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('DISCORD_UNAVAILABLE');
      expect(warns).toEqual([{ endpoint: 'oauth2/token', status: 401, reason: 'client credentials rejected' }]);

      fake.clearFailures();
      fake.failWith('/oauth2/token', 400);
      res = await app.inject({ method: 'POST', url: '/auth/activity', payload: login() });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
      expect(warns).toHaveLength(1);
    });
  });

  it('maps a network error to DISCORD_UNAVAILABLE', async () => {
    const client = createDiscordClient(testEnv('http://127.0.0.1:1'), recordingLog());
    await expect(client.exchangeCode('x')).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE', status: 503 });
  });
});

describe('guards', () => {
  const setup = (app: import('fastify').FastifyInstance) => {
    app.get('/whoami', { onRequest: [app.requireStaff] }, async (request) => request.actor);
    app.get(
      '/need-perm',
      { onRequest: [app.requireStaff, app.requirePermission('reports.view')] },
      async () => ({ ok: true }),
    );
    app.get('/need-admin', { onRequest: [app.requireStaff, app.requireLevel('ADMIN')] }, async () => ({ ok: true }));
    app.get('/service', { onRequest: [app.requireService] }, async () => ({ ok: true }));
    app.post('/write', { onRequest: [app.requireStaff] }, async () => ({ ok: true }));
    app.post('/internal/ping', { onRequest: [app.requireService] }, async () => ({ ok: true }));
  };

  async function loginAs(
    ctx: Parameters<Parameters<typeof withApp>[1]>[0],
    n: number,
    roles: string[],
  ): Promise<{ token: string; userId: string }> {
    ctx.fake.addLogin({ code: `c${n}`, user: user(n), instanceId: `i${n}`, guildId: GUILD, roles });
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/activity', payload: login(`c${n}`, `i${n}`) });
    const token = (res.json() as { sessionToken: string }).sessionToken;
    return { token, userId: (await verifySession(token, JWT_SECRET)).userId };
  }
  const get = (ctx: { app: import('fastify').FastifyInstance }, url: string, token?: string) =>
    ctx.app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('requireStaff reads the actor from the database on every request', () =>
    withApp({ redis, setup }, async (ctx) => {
      const { token, userId } = await loginAs(ctx, 1, [SUPPORT_ROLE]);
      await ctx.db.insert(rolePermissions).values({ guildId: GUILD, level: 'SUPPORT', permission: 'reports.view' });
      let res = await get(ctx, '/whoami', token);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        userId,
        discordUserId: discordId(1),
        level: 'SUPPORT',
        grants: ['reports.view'],
      });

      await ctx.db.update(staffMembers).set({ level: 'CURATOR' }).where(eq(staffMembers.userId, userId));
      res = await get(ctx, '/whoami', token);
      expect(res.json().level).toBe('CURATOR');

      await ctx.db.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.userId, userId));
      res = await get(ctx, '/whoami', token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_STAFF');
      expect(res.json().error.reason).toBe('not_in_branch');
    }));

  it('requireStaff says that the support role is missing for a curator who lost it, and only then', () =>
    withApp({ redis, setup }, async (ctx) => {
      const curator = await loginAs(ctx, 1, [SUPPORT_ROLE, CURATOR_ROLE]);
      const other = await loginAs(ctx, 2, [SUPPORT_ROLE]);
      for (const [n, roles] of [[1, [CURATOR_ROLE]], [2, []]] as const) {
        await syncMember({ db: ctx.db, config }, memberInput(n, [...roles], new Date(Date.now() + 1000)));
      }
      const a = await get(ctx, '/whoami', curator.token);
      expect(a.statusCode).toBe(403);
      expect(a.json().error.code).toBe('NOT_STAFF');
      expect(a.json().error.message).toMatch(/support role is missing/);
      expect(a.json().error.reason).toBe('support_role_missing');
      const b = await get(ctx, '/whoami', other.token);
      expect(b.statusCode).toBe(403);
      expect(b.json().error.code).toBe('NOT_STAFF');
      expect(b.json().error.message).not.toMatch(/support role/);
      expect(b.json().error.reason).toBe('not_in_branch');
    }));

  it('answers TOKEN_EXPIRED for an expired token and UNAUTHORIZED for a forged or missing one', () =>
    withApp({ redis, setup }, async (ctx) => {
      const { userId } = await loginAs(ctx, 1, [SUPPORT_ROLE]);
      const claims = { userId, discordUserId: discordId(1) };
      const key = (s: string) => new TextEncoder().encode(s);
      const expired = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 100)
        .sign(key(JWT_SECRET));
      let res = await get(ctx, '/whoami', expired);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('TOKEN_EXPIRED');

      const forged = await signSession(claims, 'another-secret-another-secret-123456');
      res = await get(ctx, '/whoami', forged);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');

      const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
      expect((await get(ctx, '/whoami', unsigned)).json().error.code).toBe('UNAUTHORIZED');
      expect((await get(ctx, '/whoami', 'garbage')).json().error.code).toBe('UNAUTHORIZED');
      res = await get(ctx, '/whoami');
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
      expect(res.json().error.requestId).toEqual(expect.any(String));
    }));

  it('requires a token whose discord id matches the stored user', () =>
    withApp({ redis, setup }, async (ctx) => {
      const { userId } = await loginAs(ctx, 1, [SUPPORT_ROLE]);
      const token = await signSession({ userId, discordUserId: discordId(9) }, JWT_SECRET);
      expect((await get(ctx, '/whoami', token)).json().error.code).toBe('UNAUTHORIZED');
    }));

  it('requirePermission and requireLevel use the actor read from the database', () =>
    withApp({ redis, setup }, async (ctx) => {
      const support = await loginAs(ctx, 1, [SUPPORT_ROLE]);
      const admin = await loginAs(ctx, 2, [ADMIN_ROLE]);
      let res = await get(ctx, '/need-perm', support.token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      await ctx.db.insert(rolePermissions).values({ guildId: GUILD, level: 'SUPPORT', permission: 'reports.view' });
      expect((await get(ctx, '/need-perm', support.token)).statusCode).toBe(200);
      expect((await get(ctx, '/need-perm', admin.token)).statusCode).toBe(200);

      res = await get(ctx, '/need-admin', support.token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect((await get(ctx, '/need-admin', admin.token)).statusCode).toBe(200);
    }));

  it('requireService accepts only the service token', () =>
    withApp({ redis, setup }, async (ctx) => {
      expect((await get(ctx, '/service', SERVICE_TOKEN)).statusCode).toBe(200);
      for (const bad of ['wrong', SERVICE_TOKEN.slice(0, -1), `${SERVICE_TOKEN}x`, undefined]) {
        const res = await get(ctx, '/service', bad);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      }
    }));

  it('does not rate limit requests that passed requireService, but limits ordinary POSTs', () =>
    withApp({ redis, setup }, async (ctx) => {
      const post = (token?: string) =>
        ctx.app.inject({
          method: 'POST',
          url: '/internal/ping',
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
      for (let i = 0; i < 35; i++) expect((await post(SERVICE_TOKEN)).statusCode).toBe(200);
      expect((await post('wrong')).statusCode).toBe(401);
      const write = () => ctx.app.inject({ method: 'POST', url: '/auth/activity', payload: {}, remoteAddress: '10.9.9.9' });
      for (let i = 0; i < 10; i++) expect((await write()).statusCode).toBe(400);
      expect((await write()).statusCode).toBe(429);
    }), 30_000);

  it('limits a user to 30 writes and 120 reads per minute, each counted separately', () =>
    withApp({ redis, setup }, async (ctx) => {
      const a = await loginAs(ctx, 1, [SUPPORT_ROLE]);
      const b = await loginAs(ctx, 2, [SUPPORT_ROLE]);
      const write = (token: string) =>
        ctx.app.inject({ method: 'POST', url: '/write', headers: { authorization: `Bearer ${token}` } });
      for (let i = 0; i < 30; i++) expect((await write(a.token)).statusCode).toBe(200);
      const limited = await write(a.token);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect((await get(ctx, '/whoami', a.token)).statusCode).toBe(200);
      expect((await write(b.token)).statusCode).toBe(200);

      for (let i = 0; i < 120; i++) expect((await get(ctx, '/whoami', b.token)).statusCode).toBe(200);
      expect((await get(ctx, '/whoami', b.token)).statusCode).toBe(429);
    }), 30_000);
});

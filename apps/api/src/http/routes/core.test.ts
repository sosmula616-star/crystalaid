import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AuditListResponse,
  MeResponse,
  PermissionsResponse,
  SettingsSchema,
  StaffListResponse,
} from '@crystalaid/contracts';
import { auditLog, rolePermissions, staffMembers, users } from '@crystalaid/database';
import { PERMISSIONS } from '@crystalaid/domain';
import { signSession } from '../../services/session.js';
import { syncMember } from '../../services/staff.js';
import { withApp, type AppContext } from '../../testing/harness.js';
import {
  ADMIN_ROLE,
  CURATOR_ROLE,
  GUILD,
  JWT_SECRET,
  SERVICE_TOKEN,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  memberInput,
  testRedis,
} from '../../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

async function member(ctx: AppContext, n: number, roles: string[]) {
  const staff = await syncMember({ db: ctx.db, config }, memberInput(n, roles));
  const token = await signSession({ userId: staff!.userId, discordUserId: discordId(n) }, JWT_SECRET);
  return { userId: staff!.userId, token };
}

const call = (ctx: AppContext, method: 'GET' | 'PATCH', url: string, token?: string, payload?: object) =>
  ctx.app.inject({
    method,
    url,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(payload ? { payload } : {}),
  });

const ROUTES: [string, 'GET' | 'PATCH'][] = [
  ['/me', 'GET'],
  ['/staff', 'GET'],
  ['/permissions', 'GET'],
  ['/permissions', 'PATCH'],
  ['/settings', 'GET'],
  ['/settings', 'PATCH'],
  ['/audit', 'GET'],
];

describe('authentication and levels', () => {
  it('answers 401 without a token', () =>
    withApp({ redis }, async (ctx) => {
      for (const [url, method] of ROUTES) {
        const res = await call(ctx, method, url);
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      }
    }));

  it('answers 403 FORBIDDEN to support on staff, permissions, settings and audit', () =>
    withApp({ redis }, async (ctx) => {
      const { token } = await member(ctx, 1, [SUPPORT_ROLE]);
      for (const [url, method] of ROUTES.filter(([u]) => u !== '/me')) {
        const res = await call(ctx, method, url, token, method === 'PATCH' ? {} : undefined);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      }
    }));

  it('lets a curator list staff but not use admin routes', () =>
    withApp({ redis }, async (ctx) => {
      const { token } = await member(ctx, 1, [SUPPORT_ROLE, CURATOR_ROLE]);
      expect((await call(ctx, 'GET', '/staff', token)).statusCode).toBe(200);
      for (const url of ['/permissions', '/settings', '/audit']) {
        expect((await call(ctx, 'GET', url, token)).statusCode, url).toBe(403);
      }
    }));

  it('answers 403 NOT_STAFF with a still-valid JWT after member.updated without branch roles', () =>
    withApp({ redis }, async (ctx) => {
      const { token } = await member(ctx, 1, [SUPPORT_ROLE]);
      expect((await call(ctx, 'GET', '/me', token)).statusCode).toBe(200);
      await syncMember({ db: ctx.db, config }, memberInput(1, [], new Date(Date.now() + 1000)));
      for (const [url, method] of ROUTES) {
        const res = await call(ctx, method, url, token, method === 'PATCH' ? {} : undefined);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().error.code).toBe('NOT_STAFF');
      }
    }));
});

describe('GET /me', () => {
  it('returns the actor with effective permissions', () =>
    withApp({ redis }, async (ctx) => {
      const curator = await member(ctx, 1, [SUPPORT_ROLE, CURATOR_ROLE]);
      const admin = await member(ctx, 2, [ADMIN_ROLE]);
      await ctx.db.update(staffMembers).set({ tokenBalance: 7, position: 'Lead' }).where(eq(staffMembers.userId, curator.userId));
      await ctx.db.insert(rolePermissions).values({ guildId: GUILD, level: 'CURATOR', permission: 'reports.view' });

      const me = MeResponse.parse((await call(ctx, 'GET', '/me', curator.token)).json());
      expect(me).toMatchObject({
        user: { id: curator.userId, discordId: discordId(1), username: 'user1', avatar: null },
        level: 'CURATOR',
        position: 'Lead',
        status: 'active',
        tokenBalance: 7,
        permissions: ['reports.view'],
      });
      const adminMe = MeResponse.parse((await call(ctx, 'GET', '/me', admin.token)).json());
      expect([...adminMe.permissions].sort()).toEqual([...PERMISSIONS].sort());
    }));

  it('shows a permission granted by an admin without logging in again', () =>
    withApp({ redis }, async (ctx) => {
      const curator = await member(ctx, 1, [SUPPORT_ROLE, CURATOR_ROLE]);
      const admin = await member(ctx, 2, [ADMIN_ROLE]);
      expect(MeResponse.parse((await call(ctx, 'GET', '/me', curator.token)).json()).permissions).not.toContain('tokens.grant');

      const patch = await call(ctx, 'PATCH', '/permissions', admin.token, { level: 'CURATOR', grants: ['tokens.grant'] });
      expect(patch.statusCode).toBe(200);
      expect(PermissionsResponse.parse(patch.json()).CURATOR).toEqual(['tokens.grant']);

      expect(MeResponse.parse((await call(ctx, 'GET', '/me', curator.token)).json()).permissions).toContain('tokens.grant');
      const [row] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'grants.updated'));
      expect(row?.actorUserId).toBe(admin.userId);
    }));
});

describe('GET /permissions', () => {
  it('returns the grants of both levels and rejects bad updates', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      await ctx.db.insert(rolePermissions).values({ guildId: GUILD, level: 'SUPPORT', permission: 'staff.note' });
      const res = await call(ctx, 'GET', '/permissions', admin.token);
      expect(PermissionsResponse.parse(res.json())).toEqual({ SUPPORT: ['staff.note'], CURATOR: [] });

      for (const body of [{ level: 'ADMIN', grants: [] }, { level: 'SUPPORT', grants: ['nope'] }, {}]) {
        const bad = await call(ctx, 'PATCH', '/permissions', admin.token, body);
        expect(bad.statusCode).toBe(400);
        expect(bad.json().error.code).toBe('VALIDATION_ERROR');
      }
    }));
});

describe('settings', () => {
  it('returns defaults, merges a partial patch and writes before and after to the audit log', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      const initial = SettingsSchema.parse((await call(ctx, 'GET', '/settings', admin.token)).json());
      expect(initial).toEqual(SettingsSchema.parse({}));

      const res = await call(ctx, 'PATCH', '/settings', admin.token, { ticketRate: 12 });
      expect(res.statusCode).toBe(200);
      expect(SettingsSchema.parse(res.json())).toEqual({ ...initial, ticketRate: 12 });
      const again = await call(ctx, 'PATCH', '/settings', admin.token, { normBonus: 70 });
      expect(SettingsSchema.parse(again.json())).toEqual({ ...initial, ticketRate: 12, normBonus: 70 });
      expect(SettingsSchema.parse((await call(ctx, 'GET', '/settings', admin.token)).json()).ticketRate).toBe(12);

      const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'settings.updated'));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => (r.data as { after: { ticketRate: number } }).after.ticketRate === 12 && (r.data as { before: { ticketRate: number } }).before.ticketRate === 10)).toBeTruthy();
      expect(rows[0]!.actorUserId).toBe(admin.userId);
    }));

  it('rejects a negative rate or a non-object body with 400 and changes nothing', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      const res = await call(ctx, 'PATCH', '/settings', admin.token, { ticketRate: -1 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      const arr = await ctx.app.inject({
        method: 'PATCH',
        url: '/settings',
        headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json' },
        payload: '[1]',
      });
      expect(arr.statusCode).toBe(400);
      expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'settings.updated'))).toHaveLength(0);
    }));
});

describe('pagination', () => {
  it('pages /staff newest first without duplicates, with equal timestamps', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      for (let n = 2; n <= 121; n++) await member(ctx, n, [SUPPORT_ROLE]);
      // ties: many members share one instant
      const tie = new Date('2026-01-01T00:00:00.123Z');
      await ctx.db.update(staffMembers).set({ joinedAt: tie });
      await ctx.db.update(staffMembers).set({ joinedAt: new Date('2026-02-01T00:00:00Z') }).where(eq(staffMembers.userId, admin.userId));

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await call(ctx, 'GET', `/staff${cursor ? `?cursor=${cursor}` : ''}`, admin.token);
        expect(res.statusCode).toBe(200);
        const body = StaffListResponse.parse(res.json());
        expect(body.items.length).toBeLessThanOrEqual(50);
        seen.push(...body.items.map((i) => i.userId));
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toHaveLength(121);
      expect(new Set(seen).size).toBe(121);
      expect(seen[0]).toBe(admin.userId);
    }));

  it('filters /staff by status and rejects an invalid status or cursor', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      const gone = await member(ctx, 2, [SUPPORT_ROLE]);
      await ctx.db.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.userId, gone.userId));
      const ids = async (q: string) =>
        StaffListResponse.parse((await call(ctx, 'GET', `/staff${q}`, admin.token)).json()).items.map((i) => i.userId);
      expect(await ids('')).toEqual([admin.userId]);
      expect(await ids('?status=inactive')).toEqual([gone.userId]);
      for (const q of ['?status=all', '?cursor=zzz', `?cursor=${Buffer.from('[1,2]').toString('base64url')}`]) {
        const res = await call(ctx, 'GET', `/staff${q}`, admin.token);
        expect(res.statusCode, q).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
    }));

  it('pages /audit newest first without duplicates, including equal timestamps', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      const tie = new Date('2026-03-01T00:00:00.000Z');
      await ctx.db.insert(auditLog).values(
        Array.from({ length: 120 }, (_, i) => ({
          guildId: GUILD,
          actorUserId: admin.userId,
          action: `test.${i}`,
          createdAt: i < 60 ? tie : new Date(tie.getTime() + i),
        })),
      );
      const total = (await ctx.db.select().from(auditLog)).length;

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await call(ctx, 'GET', `/audit${cursor ? `?cursor=${cursor}` : ''}`, admin.token);
        const body = AuditListResponse.parse(res.json());
        seen.push(...body.items.map((i) => i.id));
        const times = body.items.map((i) => i.createdAt);
        expect(times).toEqual([...times].sort().reverse());
        cursor = body.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);

      const bad = await call(ctx, 'GET', '/audit?cursor=!!', admin.token);
      expect(bad.statusCode).toBe(400);
    }));

  it('only shows rows of the configured guild', () =>
    withApp({ redis }, async (ctx) => {
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      const [other] = await ctx.db.insert(users).values({ discordId: discordId(90), username: 'x' }).returning();
      await ctx.db.insert(staffMembers).values({ guildId: '999999999999999999', userId: other!.id, level: 'SUPPORT' });
      await ctx.db.insert(auditLog).values({ guildId: '999999999999999999', action: 'foreign' });
      const staff = StaffListResponse.parse((await call(ctx, 'GET', '/staff?guildId=999999999999999999', admin.token)).json());
      expect(staff.items.map((i) => i.userId)).toEqual([admin.userId]);
      const audit = AuditListResponse.parse((await call(ctx, 'GET', '/audit', admin.token)).json());
      expect(audit.items.some((i) => i.action === 'foreign')).toBe(false);
    }));
});

describe('GET /internal/members/:discordUserId', () => {
  it('requires the service token', () =>
    withApp({ redis }, async (ctx) => {
      const url = `/internal/members/${discordId(1)}`;
      expect((await call(ctx, 'GET', url)).statusCode).toBe(401);
      expect((await call(ctx, 'GET', url, 'wrong-token')).statusCode).toBe(401);
      const admin = await member(ctx, 2, [ADMIN_ROLE]);
      expect((await call(ctx, 'GET', url, admin.token)).statusCode).toBe(401);
    }));

  it('returns level, status, balance and username, or 404', () =>
    withApp({ redis }, async (ctx) => {
      const m = await member(ctx, 1, [SUPPORT_ROLE, CURATOR_ROLE]);
      await ctx.db.update(staffMembers).set({ tokenBalance: 15 }).where(eq(staffMembers.userId, m.userId));
      const ok = await call(ctx, 'GET', `/internal/members/${discordId(1)}`, SERVICE_TOKEN);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ level: 'CURATOR', status: 'active', tokenBalance: 15, username: 'user1' });

      const missing = await call(ctx, 'GET', `/internal/members/${discordId(2)}`, SERVICE_TOKEN);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('NOT_FOUND');
    }));
});

describe('rate limit', () => {
  it('answers 429 to the 31st write of a minute from a staff user', () =>
    withApp({ redis }, async (ctx) => {
      // The limiter runs after requireStaff, so the requests must carry a staff token.
      const admin = await member(ctx, 1, [ADMIN_ROLE]);
      for (let i = 1; i <= 30; i++) {
        const res = await call(ctx, 'PATCH', '/settings', admin.token, { ticketRate: i });
        expect(res.statusCode, `request ${i}`).toBe(200);
      }
      const res = await call(ctx, 'PATCH', '/settings', admin.token, { ticketRate: 99 });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');
    }));
});

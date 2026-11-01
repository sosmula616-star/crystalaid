import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GRANTS } from '@crystalaid/domain';
import { AuditListResponse, MeResponse, PermissionsResponse, StaffListResponse } from '@crystalaid/contracts';
import { ensureSeeded } from '../services/permissions.js';
import { consumeBatch } from '../worker/consumer.js';
import { withApp, type AppContext } from '../testing/harness.js';
import {
  ADMIN_ROLE,
  CURATOR_ROLE,
  GUILD,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  recordingLog,
  testRedis,
} from '../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

const ADMIN = 1;
const CURATOR = 2;
const SUPPORT = 3;
// A curator also needs a support role (CURATOR requires both).
const CURATOR_ROLES = [SUPPORT_ROLE, CURATOR_ROLE];

const publish = (event: unknown) => redis.xadd('events:bot', '*', 'event', JSON.stringify(event));

/** Runs the real consumer until the stream has nothing left to deliver. */
async function drain(ctx: AppContext): Promise<void> {
  const log = recordingLog();
  while ((await consumeBatch({ db: ctx.db, redis, config, log, blockMs: 0 }, 'e2e')) > 0) {
    // keep reading
  }
  expect(log.errors).toEqual([]);
}

const member = (n: number, roleIds: string[]) => ({
  userId: discordId(n),
  username: `user${n}`,
  avatar: null,
  roleIds,
});

async function login(ctx: AppContext, n: number, roles: string[]): Promise<string> {
  ctx.fake.addLogin({
    code: `code-${n}`,
    user: { id: discordId(n), username: `user${n}`, avatar: null },
    instanceId: `instance-${n}`,
    guildId: GUILD,
    roles,
  });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/auth/activity',
    payload: { code: `code-${n}`, instanceId: `instance-${n}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().sessionToken as string;
}

const get = (ctx: AppContext, url: string, token: string) =>
  ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('core flow over real Redis and PostgreSQL', () => {
  it('snapshot, login, staff list, permissions, role removal, audit', () =>
    withApp({ redis }, async (ctx) => {
      // 0. First start seeds the spec defaults.
      await ensureSeeded(ctx.db, GUILD);

      // 1. The bot publishes the full member list in two parts.
      const start = Date.now() - 60_000;
      const base = { type: 'member.snapshot', guildId: GUILD, snapshotId: 'snap-1', parts: 2 };
      await publish({
        ...base,
        part: 1,
        at: new Date(start).toISOString(),
        members: [member(ADMIN, [ADMIN_ROLE]), member(CURATOR, CURATOR_ROLES)],
      });
      await publish({
        ...base,
        part: 2,
        at: new Date(start + 1000).toISOString(),
        members: [member(SUPPORT, [SUPPORT_ROLE])],
      });
      await drain(ctx);

      // 2. The curator and the admin log in through the Activity.
      const curatorToken = await login(ctx, CURATOR, CURATOR_ROLES);
      const adminToken = await login(ctx, ADMIN, [ADMIN_ROLE]);

      const me = MeResponse.parse((await get(ctx, '/me', curatorToken)).json());
      expect(me.level).toBe('CURATOR');
      expect(me.user.discordId).toBe(discordId(CURATOR));
      // Default rights from the first-start seed, no admin PATCH needed.
      expect([...me.permissions].sort()).toEqual([...DEFAULT_GRANTS.CURATOR].sort());

      // 3. GET /staff shows the roster created by the snapshot.
      const staffRes = await get(ctx, '/staff', curatorToken);
      expect(staffRes.statusCode).toBe(200);
      const staff = StaffListResponse.parse(staffRes.json());
      expect(staff.items.map((s) => [s.discordId, s.level]).sort()).toEqual(
        [
          [discordId(ADMIN), 'ADMIN'],
          [discordId(CURATOR), 'CURATOR'],
          [discordId(SUPPORT), 'SUPPORT'],
        ].sort(),
      );

      // 4. The admin changes the curator permissions; the curator cannot.
      let res = await ctx.app.inject({
        method: 'PATCH',
        url: '/permissions',
        headers: { authorization: `Bearer ${curatorToken}` },
        payload: { level: 'CURATOR', grants: ['reports.view'] },
      });
      expect(res.statusCode).toBe(403);
      res = await ctx.app.inject({
        method: 'PATCH',
        url: '/permissions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { level: 'CURATOR', grants: ['reports.view', 'staff.note'] },
      });
      expect(res.statusCode).toBe(200);
      expect(PermissionsResponse.parse(res.json()).CURATOR.sort()).toEqual(['reports.view', 'staff.note']);
      const meAfter = MeResponse.parse((await get(ctx, '/me', curatorToken)).json());
      expect(meAfter.permissions.sort()).toEqual(['reports.view', 'staff.note']);

      // 5. The curator loses the role in Discord; the old session is refused at once.
      await publish({
        type: 'member.updated',
        guildId: GUILD,
        ...member(CURATOR, []),
        at: new Date().toISOString(),
      });
      await drain(ctx);
      res = await get(ctx, '/staff', curatorToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NOT_STAFF');

      // 6. The journal holds every change, newest first.
      const audit = AuditListResponse.parse((await get(ctx, '/audit', adminToken)).json());
      const actions = audit.items.map((i) => i.action);
      expect(actions.filter((a) => a === 'staff.joined')).toHaveLength(3);
      expect(actions.filter((a) => a === 'grants.updated')).toHaveLength(1);
      expect(actions.filter((a) => a === 'staff.deactivated')).toHaveLength(1);
      expect(actions).toHaveLength(5);
      expect(actions[0]).toBe('staff.deactivated');
      const grants = audit.items.find((i) => i.action === 'grants.updated');
      expect(grants?.data).toEqual({ level: 'CURATOR', before: [...DEFAULT_GRANTS.CURATOR].sort(), after: ['reports.view', 'staff.note'] });
      expect(grants?.actorUserId).toBe(staff.items.find((s) => s.discordId === discordId(ADMIN))?.userId);
    }));
});

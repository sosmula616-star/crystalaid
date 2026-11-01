import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, careerEvents, staffMembers, users, withTestDb, type Db } from '@crystalaid/database';
import { removeMember, syncMember } from './staff.js';
import { CURATOR_ROLE, GUILD, SUPPORT_ROLE, config, discordId, memberInput } from '../test-helpers.js';

async function staffRows(db: Db) {
  return db.select().from(staffMembers);
}

describe('syncMember', () => {
  it('creates an active SUPPORT record for a new support role and ignores a repeat', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      const member = await syncMember(deps, memberInput(1, [SUPPORT_ROLE]));
      expect(member).toMatchObject({ level: 'SUPPORT', status: 'active', guildId: GUILD });

      const again = await syncMember(deps, memberInput(1, [SUPPORT_ROLE]));
      expect(again?.id).toBe(member?.id);
      expect(await staffRows(db)).toHaveLength(1);
      const audit = await db.select().from(auditLog);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'staff.joined', actorUserId: null });
      const career = await db.select().from(careerEvents);
      expect(career).toHaveLength(1);
      expect(career[0]).toMatchObject({ type: 'joined', actorUserId: null });
    }));

  it('deactivates a curator who lost the support role and records level_changed', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(2, [SUPPORT_ROLE, CURATOR_ROLE]));
      const result = await syncMember(deps, memberInput(2, [CURATOR_ROLE]));
      expect(result).toMatchObject({ status: 'inactive' });
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.deactivated'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason: 'level_changed', actorUserId: null });
      const career = await db.select().from(careerEvents).where(eq(careerEvents.type, 'deactivated'));
      expect(career).toHaveLength(1);
    }));

  it('records a level change between active levels', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(3, [SUPPORT_ROLE]));
      const result = await syncMember(deps, memberInput(3, [SUPPORT_ROLE, CURATOR_ROLE]));
      expect(result).toMatchObject({ level: 'CURATOR', status: 'active' });
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.level_changed'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason: 'level_changed' });
    }));

  it('restores a returning member with the earlier balance', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      const first = await syncMember(deps, memberInput(4, [SUPPORT_ROLE]));
      await db.update(staffMembers).set({ tokenBalance: 750 }).where(eq(staffMembers.id, first!.id));
      await syncMember(deps, memberInput(4, []));
      const back = await syncMember(deps, memberInput(4, [SUPPORT_ROLE]));
      expect(back).toMatchObject({ id: first!.id, status: 'active', tokenBalance: 750 });
      expect(await db.select().from(careerEvents).where(eq(careerEvents.type, 'reactivated'))).toHaveLength(1);
    }));

  it('creates nothing for a NONE user without a staff record', () =>
    withTestDb(async (db) => {
      const result = await syncMember({ db, config }, memberInput(5, [CURATOR_ROLE]));
      expect(result).toBeNull();
      expect(await db.select().from(users)).toHaveLength(0);
      expect(await staffRows(db)).toHaveLength(0);
      expect(await db.select().from(auditLog)).toHaveLength(0);
      expect(await db.select().from(careerEvents)).toHaveLength(0);
    }));

  it('updates the Discord profile of an existing user', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(6, [SUPPORT_ROLE]));
      await syncMember(deps, { ...memberInput(6, [SUPPORT_ROLE]), username: 'renamed', avatar: 'abc' });
      const [user] = await db.select().from(users);
      expect(user).toMatchObject({ username: 'renamed', avatar: 'abc' });
    }));
});

describe('removeMember', () => {
  it('deactivates an active member and is a no-op for unknown or inactive users', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(7, [SUPPORT_ROLE]));
      await removeMember(deps, discordId(7), new Date());
      await removeMember(deps, discordId(7), new Date());
      await removeMember(deps, discordId(99), new Date());
      expect((await staffRows(db))[0]).toMatchObject({ status: 'inactive' });
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.deactivated'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason: 'member_removed', actorUserId: null });
    }));
});

describe('stale events', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, s));

  it('keeps access closed when an old member.updated is retried after a newer role removal', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(40, [SUPPORT_ROLE], t(1)));
      await syncMember(deps, memberInput(40, [], t(3)));
      const retried = await syncMember(deps, memberInput(40, [SUPPORT_ROLE], t(2)));
      expect(retried).toMatchObject({ status: 'inactive' });
      expect((await staffRows(db))[0]).toMatchObject({ status: 'inactive', lastEventAt: t(3) });
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'staff.reactivated'))).toHaveLength(0);
    }));

  it('skips an old member.removed after a newer member.updated', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(41, [SUPPORT_ROLE], t(1)));
      await syncMember(deps, memberInput(41, [SUPPORT_ROLE, CURATOR_ROLE], t(5)));
      await removeMember(deps, discordId(41), t(3));
      expect((await staffRows(db))[0]).toMatchObject({ status: 'active', level: 'CURATOR' });
    }));

  it('applies a newer event and records its time', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(42, [SUPPORT_ROLE], t(1)));
      await syncMember(deps, memberInput(42, [SUPPORT_ROLE], t(4)));
      expect((await staffRows(db))[0]).toMatchObject({ lastEventAt: t(4) });
      await removeMember(deps, discordId(42), t(6));
      expect((await staffRows(db))[0]).toMatchObject({ status: 'inactive', lastEventAt: t(6) });
    }));
});

describe('inactive level', () => {
  it('stores NONE for an inactive row and keeps the prior level in career_events', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(60, [SUPPORT_ROLE, CURATOR_ROLE], new Date(Date.UTC(2026, 10, 1, 10, 0, 1))));
      await syncMember(deps, memberInput(61, [SUPPORT_ROLE], new Date(Date.UTC(2026, 10, 1, 10, 0, 1))));
      await syncMember(deps, memberInput(60, [], new Date(Date.UTC(2026, 10, 1, 10, 0, 2))));
      await removeMember(deps, discordId(61), new Date(Date.UTC(2026, 10, 1, 10, 0, 2)));
      const rows = await staffRows(db);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r).toMatchObject({ status: 'inactive', level: 'NONE' });
      const events = await db.select().from(careerEvents).where(eq(careerEvents.type, 'deactivated'));
      expect(events.map((e) => (e.data as { level: string }).level).sort()).toEqual(['CURATOR', 'SUPPORT']);

      // coming back sets the level again
      const back = await syncMember(deps, memberInput(60, [SUPPORT_ROLE], new Date(Date.UTC(2026, 10, 1, 10, 0, 3))));
      expect(back).toMatchObject({ status: 'active', level: 'SUPPORT' });
    }));

  it('flags a deactivation caused by a missing support role', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      await syncMember(deps, memberInput(62, [SUPPORT_ROLE, CURATOR_ROLE], new Date(Date.UTC(2026, 10, 1, 10, 0, 1))));
      await syncMember(deps, memberInput(62, [CURATOR_ROLE], new Date(Date.UTC(2026, 10, 1, 10, 0, 2))));
      const [event] = await db.select().from(careerEvents).where(eq(careerEvents.type, 'deactivated'));
      expect(event!.data).toMatchObject({ level: 'CURATOR', supportRoleMissing: true });
    }));
});

describe('first sync race', () => {
  it('lets parallel first syncs of one person succeed with one user, one staff row and one joined record', () =>
    withTestDb(async (db) => {
      const deps = { db, config };
      const at = new Date();
      // warm the pool so that the syncs really run side by side
      await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select 1`)));
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => syncMember(deps, memberInput(70, [SUPPORT_ROLE], at))),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill('fulfilled'));
      for (const r of results) expect((r as PromiseFulfilledResult<unknown>).value).toMatchObject({ level: 'SUPPORT' });
      expect(await db.select().from(users)).toHaveLength(1);
      expect(await staffRows(db)).toHaveLength(1);
      expect(await db.select().from(careerEvents).where(eq(careerEvents.type, 'joined'))).toHaveLength(1);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'staff.joined'))).toHaveLength(1);
    }));
});

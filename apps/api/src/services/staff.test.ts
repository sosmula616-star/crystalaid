import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, careerEvents, staffMembers, users, withTestDb, type Db } from '@crystalaid/database';
import { applySnapshot, removeMember, syncMember } from './staff.js';
import {
  CURATOR_ROLE,
  GUILD,
  SUPPORT_ROLE,
  clearOwnedKeys,
  config,
  discordId,
  memberInput,
  recordingLog,
  testRedis,
} from '../test-helpers.js';

const redis = testRedis();
beforeEach(() => clearOwnedKeys(redis));
afterAll(() => redis.quit());

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

describe('applySnapshot', () => {
  const snap = (id: string, nums: number[], final: boolean) => ({
    type: 'member.snapshot' as const,
    guildId: GUILD,
    snapshotId: id,
    members: nums.map((n) => ({ userId: discordId(n), username: `user${n}`, avatar: null, roleIds: [SUPPORT_ROLE] })),
    final,
    at: new Date().toISOString(),
  });

  async function statusOf(db: Db, n: number) {
    const [row] = await db
      .select({ status: staffMembers.status })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(eq(users.discordId, discordId(n)));
    return row?.status;
  }

  it('deactivates only absent members and only after the final part', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      for (const n of [10, 11, 12]) await syncMember({ db, config }, memberInput(n, [SUPPORT_ROLE]));

      await applySnapshot(deps, snap('s1', [10], false));
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('active');
      expect(await redis.scard('snapshot:s1')).toBe(1);
      const ttl = await redis.ttl('snapshot:s1');
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);

      await applySnapshot(deps, snap('s1', [11], true));
      expect(await statusOf(db, 10)).toBe('active');
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('inactive');
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.deactivated'));
      expect(audit).toHaveLength(1);
      expect(await db.select().from(careerEvents).where(eq(careerEvents.type, 'deactivated'))).toHaveLength(1);
    }));

  it('creates members that appear in the snapshot', () =>
    withTestDb(async (db) => {
      await applySnapshot({ db, redis, config, log: recordingLog() }, snap('s2', [20], true));
      expect(await statusOf(db, 20)).toBe('active');
    }));

  it('deactivates nobody for an empty final snapshot and logs a warning', () =>
    withTestDb(async (db) => {
      const log = recordingLog();
      await syncMember({ db, config }, memberInput(30, [SUPPORT_ROLE]));
      await applySnapshot({ db, redis, config, log }, snap('s3', [], true));
      expect(await statusOf(db, 30)).toBe('active');
      expect(log.warns).toHaveLength(1);
    }));
});

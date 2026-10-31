import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, careerEvents, staffMembers, users, withTestDb, type Db } from '@crystalaid/database';
import { applySnapshot, syncMember, type SnapshotEvent } from './staff.js';
import {
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

const snap = (id: string, part: number, parts: number, nums: number[], at = new Date()): SnapshotEvent => ({
  type: 'member.snapshot',
  guildId: GUILD,
  snapshotId: id,
  members: nums.map((n) => ({ userId: discordId(n), username: `user${n}`, avatar: null, roleIds: [SUPPORT_ROLE] })),
  part,
  parts,
  at: at.toISOString(),
});

async function statusOf(db: Db, n: number) {
  const [row] = await db
    .select({ status: staffMembers.status })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(eq(users.discordId, discordId(n)));
  return row?.status;
}

async function seed(db: Db, nums: number[], at: Date) {
  for (const n of nums) await syncMember({ db, config }, memberInput(n, [SUPPORT_ROLE], at));
}

const past = () => new Date(Date.now() - 60_000);

describe('applySnapshot', () => {
  it('deactivates only absent members and only after the last part', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      await seed(db, [10, 11, 12], past());

      await applySnapshot(deps, snap('s1', 1, 2, [10]));
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('active');
      expect(await redis.scard('snapshot:s1:members')).toBe(1);
      const ttl = await redis.ttl('snapshot:s1:members');
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(await redis.ttl('snapshot:s1:done')).toBeGreaterThan(3500);

      await applySnapshot(deps, snap('s1', 2, 2, [11]));
      expect(await statusOf(db, 10)).toBe('active');
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('inactive');
      const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'staff.deactivated'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason: 'not_in_snapshot' });
      expect(await db.select().from(careerEvents).where(eq(careerEvents.type, 'deactivated'))).toHaveLength(1);
      // keys stay until they expire
      expect(await redis.exists('snapshot:s1:members', 'snapshot:s1:done', 'snapshot:s1:applied')).toBe(3);
    }));

  it('deactivates nobody when part 1 fails and only the last part arrives', () =>
    withTestDb(async (db) => {
      const log = recordingLog();
      const deps = { db, redis, config, log };
      await seed(db, [10, 11, 12], past());

      const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'));
      await expect(applySnapshot(deps, snap('s2', 1, 2, [10]))).rejects.toThrow('db down');
      spy.mockRestore();
      expect(await redis.exists('snapshot:s2:done')).toBe(0);

      await applySnapshot(deps, snap('s2', 2, 2, [11]));
      expect(await statusOf(db, 10)).toBe('active');
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('active');
      expect(await redis.exists('snapshot:s2:applied')).toBe(0);
    }));

  it('deactivates nobody when the last part is redelivered after success', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      await seed(db, [10, 11, 12], past());
      await applySnapshot(deps, snap('s3', 1, 2, [10]));
      await applySnapshot(deps, snap('s3', 2, 2, [11]));
      expect(await statusOf(db, 12)).toBe('inactive');

      // 12 comes back, then the last part is delivered again
      await syncMember({ db, config }, memberInput(12, [SUPPORT_ROLE], new Date()));
      await applySnapshot(deps, snap('s3', 2, 2, [11]));
      expect(await statusOf(db, 12)).toBe('active');
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'staff.deactivated'))).toHaveLength(1);
    }));

  it('accepts parts in any order', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      await seed(db, [10, 11, 12, 13], past());
      await applySnapshot(deps, snap('s4', 3, 3, [12]));
      await applySnapshot(deps, snap('s4', 1, 3, [10]));
      expect(await statusOf(db, 13)).toBe('active');
      await applySnapshot(deps, snap('s4', 2, 3, [11]));
      expect(await statusOf(db, 10)).toBe('active');
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('active');
      expect(await statusOf(db, 13)).toBe('inactive');
    }));

  it('never deactivates a present member when two parts run at the same time', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      await seed(db, [10, 11, 12], past());
      const results = await Promise.allSettled([
        applySnapshot(deps, snap('s5', 1, 2, [10])),
        applySnapshot(deps, snap('s5', 2, 2, [11])),
      ]);
      // a part that lost the lock throws and is retried by the consumer
      for (const [i, r] of results.entries()) {
        if (r.status === 'rejected') await applySnapshot(deps, snap('s5', i + 1, 2, [10 + i]));
      }
      expect(await statusOf(db, 10)).toBe('active');
      expect(await statusOf(db, 11)).toBe('active');
      expect(await statusOf(db, 12)).toBe('inactive');
    }));

  it('throws when another worker holds the lock so the entry is retried', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      await seed(db, [10, 11], past());
      await redis.set('snapshot:s6:lock', '1', 'EX', 60);
      await expect(applySnapshot(deps, snap('s6', 1, 1, [10]))).rejects.toThrow(/another worker/);
      expect(await statusOf(db, 11)).toBe('active');
    }));

  it('creates members that appear in the snapshot', () =>
    withTestDb(async (db) => {
      await applySnapshot({ db, redis, config, log: recordingLog() }, snap('s7', 1, 1, [20]));
      expect(await statusOf(db, 20)).toBe('active');
    }));

  it('deactivates nobody for an empty snapshot and logs a warning', () =>
    withTestDb(async (db) => {
      const log = recordingLog();
      await seed(db, [30], past());
      await applySnapshot({ db, redis, config, log }, snap('s8', 1, 1, []));
      expect(await statusOf(db, 30)).toBe('active');
      expect(log.warns).toHaveLength(1);
    }));

  it('does not deactivate an absent member whose newest event is later than the snapshot', () =>
    withTestDb(async (db) => {
      const deps = { db, redis, config, log: recordingLog() };
      const snapshotAt = new Date(Date.now() - 30_000);
      await seed(db, [10, 11, 12], past());
      // 12 got a fresh role event after the snapshot was taken
      await syncMember({ db, config }, memberInput(12, [SUPPORT_ROLE], new Date(snapshotAt.getTime() + 5_000)));
      await applySnapshot(deps, snap('s9', 1, 1, [10], snapshotAt));
      expect(await statusOf(db, 11)).toBe('inactive');
      expect(await statusOf(db, 12)).toBe('active');
    }));
});

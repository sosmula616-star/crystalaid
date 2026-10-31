import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, staffMembers, withTestDb } from '@crystalaid/database';
import { consumeBatch } from './consumer.js';
import {
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

const updated = (n: number, guildId = GUILD) => ({
  type: 'member.updated',
  guildId,
  userId: discordId(n),
  username: `user${n}`,
  avatar: null,
  roleIds: [SUPPORT_ROLE],
  at: new Date().toISOString(),
});

const publish = (payload: unknown) =>
  redis.xadd('events:bot', '*', 'event', typeof payload === 'string' ? payload : JSON.stringify(payload));

async function pendingCount(): Promise<number> {
  const summary = (await redis.xpending('events:bot', 'workers')) as [number, ...unknown[]];
  return Number(summary[0]);
}

describe('consumeBatch', () => {
  it('handles a stream event and acknowledges it', () =>
    withTestDb(async (db) => {
      await publish(updated(1));
      const n = await consumeBatch({ db, redis, config, log: recordingLog() }, 'c1');
      expect(n).toBe(1);
      expect(await db.select().from(staffMembers)).toHaveLength(1);
      expect(await pendingCount()).toBe(0);
    }));

  it('returns 0 for an empty stream', () =>
    withTestDb(async (db) => {
      expect(await consumeBatch({ db, redis, config, log: recordingLog() }, 'c1')).toBe(0);
    }));

  it('sends bad JSON and schema failures to events:dead, acknowledges them, and continues', () =>
    withTestDb(async (db) => {
      await publish('{not json');
      await publish({ type: 'member.updated', guildId: 'bad' });
      await publish(updated(2));
      await consumeBatch({ db, redis, config, log: recordingLog() }, 'c1');
      expect(await redis.xlen('events:dead')).toBe(2);
      const dead = await redis.xrange('events:dead', '-', '+');
      expect(dead[0]![1]).toContain('{not json');
      expect(await db.select().from(staffMembers)).toHaveLength(1);
      expect(await pendingCount()).toBe(0);
    }));

  it('acknowledges and ignores events of another guild', () =>
    withTestDb(async (db) => {
      const log = recordingLog();
      await publish(updated(3, '999999999999999999'));
      await consumeBatch({ db, redis, config, log }, 'c1');
      expect(await db.select().from(staffMembers)).toHaveLength(0);
      expect(await pendingCount()).toBe(0);
      expect(log.infos.some((m) => m.includes('ignored'))).toBe(true);
    }));

  it('leaves the event unacknowledged on a database error and reprocesses it without duplicates', () =>
    withTestDb(async (db) => {
      await publish(updated(4));
      const log = recordingLog();
      const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'));
      const first = await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1');
      expect(first).toBe(0);
      expect(await pendingCount()).toBe(1);
      expect(log.errors).toHaveLength(1);
      spy.mockRestore();

      const second = await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c2');
      expect(second).toBe(1);
      expect(await pendingCount()).toBe(0);
      expect(await db.select().from(staffMembers)).toHaveLength(1);
      expect(await db.select().from(auditLog).where(eq(auditLog.action, 'staff.joined'))).toHaveLength(1);
    }));

  it('does not reclaim entries that are still fresh', () =>
    withTestDb(async (db) => {
      await publish(updated(5));
      const log = recordingLog();
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'));
      await consumeBatch({ db, redis, config, log }, 'c1');
      vi.restoreAllMocks();
      expect(await consumeBatch({ db, redis, config, log }, 'c2')).toBe(0);
      expect(await pendingCount()).toBe(1);
    }));

  it('processing the same event twice creates no duplicates', () =>
    withTestDb(async (db) => {
      await publish(updated(6));
      await publish(updated(6));
      await consumeBatch({ db, redis, config, log: recordingLog() }, 'c1');
      expect(await db.select().from(staffMembers)).toHaveLength(1);
      expect(await db.select().from(auditLog)).toHaveLength(1);
    }));
});

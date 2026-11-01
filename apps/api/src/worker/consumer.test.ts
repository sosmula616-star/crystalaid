import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, createDb, staffMembers, withTestDb } from '@crystalaid/database';
import { MAX_DELIVERIES, consumeBatch } from './consumer.js';
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

describe('reclaim', () => {
  it('leaves a live entry that another consumer claimed first', () =>
    withTestDb(async (db) => {
      await publish(updated(10));
      const log = recordingLog();
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'));
      await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1');
      vi.restoreAllMocks();
      // XCLAIM returns nothing for the entry, as if another consumer had just taken it
      vi.spyOn(redis, 'xclaim').mockResolvedValueOnce([]);
      expect(await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c2')).toBe(0);
      vi.restoreAllMocks();
      expect(await pendingCount()).toBe(1);
      expect(await redis.xlen('events:bot')).toBe(1);
    }));

  it('acknowledges a pending entry that no longer exists in the stream', () =>
    withTestDb(async (db) => {
      const id = (await publish(updated(11)))!;
      const log = recordingLog();
      vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('db down'));
      await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1');
      vi.restoreAllMocks();
      await redis.xdel('events:bot', id);
      expect(await pendingCount()).toBe(1);
      await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c2');
      expect(await pendingCount()).toBe(0);
      expect(await db.select().from(staffMembers)).toHaveLength(0);
    }));

  it('moves an entry delivered more than 5 times to events:dead and acknowledges it', () =>
    withTestDb(async (db) => {
      await publish(updated(12));
      const log = recordingLog();
      vi.spyOn(db, 'transaction').mockRejectedValue(new Error('db down'));
      for (let i = 0; i < 6; i += 1) {
        expect(await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1')).toBe(0);
      }
      expect(await pendingCount()).toBe(1);
      expect(await redis.xlen('events:dead')).toBe(0);
      vi.restoreAllMocks();

      await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1');
      expect(await pendingCount()).toBe(0);
      const dead = await redis.xrange('events:dead', '-', '+');
      expect(dead).toHaveLength(1);
      expect(dead[0]![1].join(' ')).toContain('delivery limit exceeded');
      expect(dead[0]![1].join(' ')).toContain(discordId(12));
      expect(await db.select().from(staffMembers)).toHaveLength(0);
    }));

  it('finds stale entries beyond the first 50 pending ones', () =>
    withTestDb(async (db) => {
      await consumeBatch({ db, redis, config, log: recordingLog(), blockMs: 0 }, 'probe'); // creates the group
      for (let n = 100; n < 160; n += 1) await publish(updated(n));
      // 'old' takes all 60 without handling them
      const read = (await redis.xreadgroup('GROUP', 'workers', 'old', 'COUNT', 100, 'STREAMS', 'events:bot', '>')) as
        | [string, [string, string[]][]][]
        | null;
      const ids = read![0]![1].map(([id]) => id);
      expect(ids).toHaveLength(60);
      await new Promise((r) => setTimeout(r, 400));
      // the 50 oldest are touched again, so they look busy; the last 10 stay stale
      await redis.xclaim('events:bot', 'workers', 'busy', 0, ...ids.slice(0, 50));

      const n = await consumeBatch({ db, redis, config, log: recordingLog(), minIdleMs: 300, blockMs: 0 }, 'c1');
      expect(n).toBe(10);
      expect(await db.select().from(staffMembers)).toHaveLength(10);
      expect(await pendingCount()).toBe(50);
    }));
});

describe('database outage', () => {
  it('spends no delivery count while the database is unreachable, then applies the event', () =>
    withTestDb(async (db) => {
      const log = recordingLog();
      await consumeBatch({ db, redis, config, log, blockMs: 0 }, 'probe'); // creates the group
      await publish(updated(20));
      const down = createDb('postgres://nobody:nothing@127.0.0.1:1/none');
      try {
        // far more attempts than MAX_DELIVERIES, with every entry always eligible for reclaim
        for (let i = 0; i < MAX_DELIVERIES + 4; i += 1) {
          await expect(consumeBatch({ db: down, redis, config, log, minIdleMs: 0 }, 'c1')).rejects.toThrow();
        }
      } finally {
        await down.$client.end();
      }
      expect(await redis.xlen('events:dead')).toBe(0);
      expect(await redis.xlen('events:bot')).toBe(1);
      expect(await pendingCount()).toBe(0);

      expect(await consumeBatch({ db, redis, config, log, minIdleMs: 0 }, 'c1')).toBe(1);
      expect(await db.select().from(staffMembers)).toHaveLength(1);
      expect(await redis.xlen('events:dead')).toBe(0);
    }));
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, staffMembers, withTestDb } from '@crystalaid/database';
import { startWorker } from './main.js';
import { GUILD, SUPPORT_ROLE, clearOwnedKeys, config, discordId, recordingLog, testRedis } from '../test-helpers.js';

const control = testRedis();
beforeEach(() => clearOwnedKeys(control));
afterAll(() => control.quit());

describe('startWorker', () => {
  it('processes events, then stopWorker ends the loop and closes both connections', () =>
    withTestDb(async () => {
      const db = createDb(process.env.TEST_DATABASE_URL!);
      const redis = testRedis();
      const log = recordingLog();
      await control.xadd(
        'events:bot',
        '*',
        'event',
        JSON.stringify({
          type: 'member.updated',
          guildId: GUILD,
          userId: discordId(1),
          username: 'u1',
          avatar: null,
          roleIds: [SUPPORT_ROLE],
          at: new Date().toISOString(),
        }),
      );
      const worker = startWorker({ db, redis, config, log, consumer: 'test-worker', blockMs: 50 });

      const deadline = Date.now() + 5000;
      while ((await db.select().from(staffMembers)).length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await db.select().from(staffMembers)).toHaveLength(1);

      await worker.stopWorker();
      await worker.done;
      expect(redis.status).toBe('end');
      expect(db.$client.ended).toBe(true);
      expect(log.infos).toContain('worker stopping');
      // a second stop is harmless
      await worker.stopWorker();
    }));
});

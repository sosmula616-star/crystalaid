import { describe, expect, it } from 'vitest';
import { auditLog, ptSlots, withTestDb } from '@crystalaid/database';
import { loadActor } from './actor.js';
import { confirmReminder, dueReminders, listSlots, removeSlot, setSlot } from './pt.js';
import { removeMember, syncMember } from './staff.js';
import { ADMIN_ROLE, SUPPORT_ROLE, config, discordId, memberInput } from '../test-helpers.js';

const HOUR = new Date('2026-11-02T10:00:00Z'); // 13:00 in Moscow
const MIN = 60_000;

async function setup(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const deps = { db, config };
  await syncMember(deps, memberInput(1, [ADMIN_ROLE]));
  await syncMember(deps, memberInput(2, [SUPPORT_ROLE]));
  const admin = (await loadActor(deps, discordId(1)))!;
  const support = (await loadActor(deps, discordId(2)))!;
  return { deps, admin, support };
}

describe('PT slots', () => {
  it('sets a slot once, audits it, and lists it by local day', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      expect(await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) })).toEqual({ created: true });
      expect(await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) })).toEqual({ created: false });
      expect(await db.select().from(ptSlots)).toHaveLength(1);
      expect((await db.select().from(auditLog)).filter((a) => a.action === 'pt.set')).toHaveLength(1);

      const day = await listSlots(deps, '2026-11-02');
      expect(day).toHaveLength(1);
      expect(day[0]).toMatchObject({ startsAt: HOUR, discordId: discordId(2) });
      // 21:00 Moscow is still Nov 2; 00:00 Moscow Nov 3 is 21:00Z and belongs to Nov 3.
      await setSlot(deps, admin, { startsAt: new Date('2026-11-02T21:00:00Z'), discordUserId: discordId(2) });
      expect(await listSlots(deps, '2026-11-02')).toHaveLength(1);
      expect(await listSlots(deps, '2026-11-03')).toHaveLength(1);
    }));

  it('rejects a non-staff target, a non-whole hour, and an actor without shifts.edit', async () =>
    withTestDb(async (db) => {
      const { deps, admin, support } = await setup(db);
      await expect(setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(77) })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      for (const startsAt of [new Date(HOUR.getTime() + 30 * MIN), new Date(HOUR.getTime() + 1000)]) {
        await expect(setSlot(deps, admin, { startsAt, discordUserId: discordId(2) })).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      }
      await expect(setSlot(deps, support, { startsAt: HOUR, discordUserId: discordId(2) })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(await db.select().from(ptSlots)).toHaveLength(0);
    }));

  it('removes a slot and fails on one that is not there', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) });
      await removeSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) });
      expect(await db.select().from(ptSlots)).toHaveLength(0);
      await expect(removeSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }));

  it('hands a reminder out until it is confirmed, only within 5 minutes, and confirms once', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) });
      expect(await dueReminders(deps, new Date(HOUR.getTime() - 6 * MIN))).toEqual([]);
      const at = new Date(HOUR.getTime() - 4 * MIN);
      const first = await dueReminders(deps, at);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ discordId: discordId(2), startsAt: HOUR });
      // A failed send is not confirmed, so the next pass (or a restarted bot) gets it again.
      expect(await dueReminders(deps, new Date(at.getTime() + MIN))).toHaveLength(1);
      await Promise.all([1, 2, 3].map(() => confirmReminder(deps, first[0]!.slotId, at)));
      expect(await dueReminders(deps, at)).toEqual([]);
      expect((await db.select().from(auditLog)).filter((a) => a.action === 'pt.reminded')).toHaveLength(1);
    }));

  it('does not remind staff who are no longer active', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(2) });
      await removeMember(deps, discordId(2), new Date());
      expect(await dueReminders(deps, new Date(HOUR.getTime() - 4 * MIN))).toEqual([]);
    }));
});
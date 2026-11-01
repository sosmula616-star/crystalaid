import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  auditLog,
  ptSlots,
  staffDaily,
  ticketChallenges,
  ticketMessages,
  tickets,
  users,
  withTestDb,
  type Db,
} from '@crystalaid/database';
import { loadActor } from './actor.js';
import { setSlot } from './pt.js';
import { syncMember } from './staff.js';
import {
  activeTicket,
  addMessage,
  claimTicket,
  closeTicket,
  createTicket,
  dueTickets,
  rateTicket,
} from './tickets.js';
import { ADMIN_ROLE, CURATOR_ROLE, SUPPORT_ROLE, config, discordId, memberInput } from '../test-helpers.js';

const NOW = new Date('2026-11-02T10:30:00Z'); // 13:30 in Moscow
const HOUR = new Date('2026-11-02T10:00:00Z'); // the PT hour containing NOW
const MIN = 60_000;

const ADMIN = 1;
const SUPPORT_A = 2;
const SUPPORT_B = 3;
const OFF_DUTY = 4;
const REQUESTER = 50;

async function setup(db: Db, onDuty: number[] = [SUPPORT_A, SUPPORT_B]) {
  const deps = { db, config };
  await syncMember(deps, memberInput(ADMIN, [ADMIN_ROLE]));
  for (const n of [SUPPORT_A, SUPPORT_B, OFF_DUTY]) await syncMember(deps, memberInput(n, [SUPPORT_ROLE]));
  const admin = (await loadActor(deps, discordId(ADMIN)))!;
  for (const n of onDuty) await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(n) });
  return { deps, admin };
}

const open = (deps: { db: Db; config: typeof config }, message = 'help me', now = NOW, n = REQUESTER) =>
  createTicket(deps, { requesterDiscordId: discordId(n), username: `user${n}`, message }, now);

const challengeFor = (c: Awaited<ReturnType<typeof open>>, n: number) =>
  c.challenges.find((x) => x.supportDiscordId === discordId(n))!.challenge;

describe('createTicket', () => {
  it('stores the first message and challenges only supports on duty now', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db, [SUPPORT_A]);
      await setSlot(deps, (await loadActor(deps, discordId(ADMIN)))!, {
        startsAt: new Date(HOUR.getTime() + 60 * MIN),
        discordUserId: discordId(SUPPORT_B),
      });
      const created = await open(deps);
      expect(created.challenges.map((c) => c.supportDiscordId)).toEqual([discordId(SUPPORT_A)]);
      const { target, options } = created.challenges[0]!.challenge;
      expect(new Set(options).size).toBe(4);
      expect(options).toContain(target);
      const [stored] = await db.select().from(ticketChallenges);
      expect(stored!.answer).toBe(target);
      const msgs = await db.select().from(ticketMessages);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ content: 'help me', isStaff: false });
      expect(created.ticket.offeredAt).not.toBeNull();
    }));

  it('gives an on-duty requester no challenge for their own ticket', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db, [SUPPORT_A, SUPPORT_B]);
      const created = await open(deps, 'mine', NOW, SUPPORT_A);
      expect(created.challenges.map((c) => c.supportDiscordId)).toEqual([discordId(SUPPORT_B)]);
    }));

  it('waits when nobody is on duty', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db, []);
      const created = await open(deps);
      expect(created.challenges).toEqual([]);
      expect(created.ticket.offeredAt).toBeNull();
    }));

  it('allows one open ticket, a 5 minute cooldown, and validates the first message', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      const first = await open(deps);
      await expect(open(deps)).rejects.toMatchObject({ code: 'CONFLICT' });
      await closeTicket(deps, first.ticket.id, admin, new Date(NOW.getTime() + MIN));
      await expect(open(deps, 'again', new Date(NOW.getTime() + 2 * MIN))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      await expect(open(deps, 'again', new Date(NOW.getTime() + 5 * MIN))).resolves.toBeDefined();
      await expect(open(deps, '   ', NOW, 60)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(open(deps, 'x'.repeat(301), NOW, 61)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(open(deps, 'x'.repeat(300), NOW, 62)).resolves.toBeDefined();
    }));
});

describe('claimTicket', () => {
  it('gives one attempt per support: a wrong choice spends it', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db);
      const created = await open(deps);
      const a = challengeFor(created, SUPPORT_A);
      const wrong = a.options.find((o) => o !== a.target)!;
      expect((await claimTicket(deps, created.ticket.id, discordId(SUPPORT_A), wrong, NOW)).result).toBe('wrong');
      expect((await claimTicket(deps, created.ticket.id, discordId(SUPPORT_A), a.target, NOW)).result).toBe('wrong');
      expect((await db.select().from(tickets))[0]!.status).toBe('open');
      const b = challengeFor(created, SUPPORT_B);
      expect((await claimTicket(deps, created.ticket.id, discordId(SUPPORT_B), b.target, NOW)).result).toBe('claimed');
    }));

  it('reports already_taken and closed, and counts the claim', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      const created = await open(deps);
      const id = created.ticket.id;
      const r = await claimTicket(deps, id, discordId(SUPPORT_A), challengeFor(created, SUPPORT_A).target, NOW);
      expect(r).toMatchObject({ result: 'claimed', requesterDiscordId: discordId(REQUESTER) });
      expect(
        (await claimTicket(deps, id, discordId(SUPPORT_B), challengeFor(created, SUPPORT_B).target, NOW)).result,
      ).toBe('already_taken');
      expect((await db.select().from(staffDaily))[0]).toMatchObject({ ticketsClaimed: 1 });
      await closeTicket(deps, id, admin, NOW);
      expect(
        (await claimTicket(deps, id, discordId(SUPPORT_B), challengeFor(created, SUPPORT_B).target, NOW)).result,
      ).toBe('closed');
    }));

  it('lets exactly one of 10 parallel correct answers claim', async () =>
    withTestDb(async (db) => {
      const supports = Array.from({ length: 10 }, (_, i) => 10 + i);
      const { deps } = await setup(db, []);
      for (const n of supports) await syncMember(deps, memberInput(n, [SUPPORT_ROLE]));
      const admin = (await loadActor(deps, discordId(ADMIN)))!;
      for (const n of supports) await setSlot(deps, admin, { startsAt: HOUR, discordUserId: discordId(n) });
      const created = await open(deps);
      expect(created.challenges).toHaveLength(10);
      const results = await Promise.all(
        supports.map((n) =>
          claimTicket(deps, created.ticket.id, discordId(n), challengeFor(created, n).target, NOW),
        ),
      );
      expect(results.filter((r) => r.result === 'claimed')).toHaveLength(1);
      expect(results.filter((r) => r.result === 'already_taken')).toHaveLength(9);
      const [t] = await db.select().from(tickets);
      expect(t!.status).toBe('claimed');
    }));
});

describe('messages, close and rating', () => {
  async function claimed(db: Db) {
    const { deps, admin } = await setup(db);
    const created = await open(deps);
    await claimTicket(deps, created.ticket.id, discordId(SUPPORT_A), challengeFor(created, SUPPORT_A).target, NOW);
    return { deps, admin, id: created.ticket.id };
  }

  it('sets first_response_at on the first support reply only', async () =>
    withTestDb(async (db) => {
      const { deps, id } = await claimed(db);
      const t1 = new Date(NOW.getTime() + MIN);
      const t2 = new Date(NOW.getTime() + 2 * MIN);
      expect(await addMessage(deps, id, discordId(REQUESTER), 'hello?', t1)).toEqual({
        isStaff: false,
        recipientDiscordId: discordId(SUPPORT_A),
      });
      expect((await db.select().from(tickets))[0]!.firstResponseAt).toBeNull();
      await addMessage(deps, id, discordId(SUPPORT_A), 'hi', t1);
      await addMessage(deps, id, discordId(SUPPORT_A), 'again', t2);
      expect((await db.select().from(tickets))[0]!.firstResponseAt).toEqual(t1);
      await expect(addMessage(deps, id, discordId(SUPPORT_B), 'me too')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await activeTicket(deps, discordId(SUPPORT_A))).toMatchObject({ role: 'support', status: 'claimed' });
    }));

  it('closes for the claimer or an admin, gives a transcript in the config timezone, and only once', async () =>
    withTestDb(async (db) => {
      const { deps, admin, id } = await claimed(db);
      await addMessage(deps, id, discordId(SUPPORT_A), 'reply text', new Date(NOW.getTime() + MIN));
      const other = (await loadActor(deps, discordId(SUPPORT_B)))!;
      await expect(closeTicket(deps, id, other, NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const claimer = (await loadActor(deps, discordId(SUPPORT_A)))!;
      const closedAt = new Date(NOW.getTime() + 5 * MIN);
      const r = await closeTicket(deps, id, claimer, closedAt);
      expect(r.transcript).toContain('[2026-11-02 13:30:00] user50: help me');
      expect(r.transcript).toContain('[2026-11-02 13:31:00] user2 (support): reply text');
      expect(r.transcript).toContain('Closed: 2026-11-02 13:35:00');
      await expect(closeTicket(deps, id, admin, closedAt)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await db.select().from(staffDaily))[0]).toMatchObject({ ticketsClaimed: 1, ticketsClosed: 1 });
      await expect(addMessage(deps, id, discordId(REQUESTER), 'late')).rejects.toMatchObject({ code: 'CONFLICT' });
      const actions = (await db.select().from(auditLog)).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['ticket.created', 'ticket.claimed', 'ticket.closed']));
    }));

  it('lets an admin close an unclaimed ticket', async () =>
    withTestDb(async (db) => {
      const { deps, admin } = await setup(db);
      const created = await open(deps);
      await closeTicket(deps, created.ticket.id, admin, NOW);
      expect((await db.select().from(tickets))[0]!.status).toBe('closed');
    }));

  it('accepts one rating from 1 to 5, only from the requester, only when closed', async () =>
    withTestDb(async (db) => {
      const { deps, id } = await claimed(db);
      await expect(rateTicket(deps, id, discordId(REQUESTER), 5)).rejects.toMatchObject({ code: 'CONFLICT' });
      const claimer = (await loadActor(deps, discordId(SUPPORT_A)))!;
      await closeTicket(deps, id, claimer, NOW);
      await expect(rateTicket(deps, id, discordId(SUPPORT_A), 5)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (const bad of [0, 6, 2.5]) {
        await expect(rateTicket(deps, id, discordId(REQUESTER), bad)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      }
      await rateTicket(deps, id, discordId(REQUESTER), 4, NOW);
      await expect(rateTicket(deps, id, discordId(REQUESTER), 5)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await db.select().from(tickets))[0]).toMatchObject({ rating: 4 });
    }));
});

describe('dueTickets', () => {
  it('offers a waiting ticket when a PT starts, once', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db, []);
      const created = await open(deps);
      expect(await dueTickets(deps, NOW)).toEqual([]);
      const admin = (await loadActor(deps, discordId(ADMIN)))!;
      const next = new Date(HOUR.getTime() + 60 * MIN);
      await setSlot(deps, admin, { startsAt: next, discordUserId: discordId(SUPPORT_A) });
      const at = new Date(next.getTime() + MIN);
      const due = await dueTickets(deps, at);
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({ ticketId: created.ticket.id, reoffer: false });
      expect(due[0]!.challenges.map((c) => c.supportDiscordId)).toEqual([discordId(SUPPORT_A)]);
      expect(await dueTickets(deps, at)).toEqual([]);
    }));

  it('re-offers after 5 minutes, skipping supports who already attempted, and logs it', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db);
      const created = await open(deps);
      const a = challengeFor(created, SUPPORT_A);
      await claimTicket(deps, created.ticket.id, discordId(SUPPORT_A), a.options.find((o) => o !== a.target)!, NOW);
      expect(await dueTickets(deps, new Date(NOW.getTime() + 4 * MIN))).toEqual([]);
      const due = await dueTickets(deps, new Date(NOW.getTime() + 6 * MIN));
      expect(due).toHaveLength(1);
      expect(due[0]!.reoffer).toBe(true);
      expect(due[0]!.challenges.map((c) => c.supportDiscordId)).toEqual([discordId(SUPPORT_B)]);
      expect((await db.select().from(auditLog).where(eq(auditLog.action, 'ticket.reoffered')))).toHaveLength(1);
      // The new challenge is the one that counts.
      const fresh = due[0]!.challenges[0]!.challenge;
      expect(
        (await claimTicket(deps, created.ticket.id, discordId(SUPPORT_B), fresh.target, NOW)).result,
      ).toBe('claimed');
    }));

  it('does not offer a ticket to the only person on duty when it is their own', async () =>
    withTestDb(async (db) => {
      const { deps } = await setup(db, [SUPPORT_A]);
      await open(deps, 'mine', NOW, SUPPORT_A);
      expect(await dueTickets(deps, new Date(NOW.getTime() + 10 * MIN))).toEqual([]);
      expect(await db.select().from(ptSlots)).toHaveLength(1);
    }));
});

describe('config users', () => {
  it('keeps a developer from the config in the roster without any role, also when a snapshot misses them', async () =>
    withTestDb(async (db) => {
      const devId = discordId(90);
      const cfg = { ...config, users: { admins: [discordId(91)], developers: [devId] } };
      const deps = { db, config: cfg };
      expect(await syncMember(deps, memberInput(90, []))).toMatchObject({ level: 'DEVELOPER', status: 'active' });
      expect(await syncMember(deps, memberInput(91, [CURATOR_ROLE]))).toMatchObject({ level: 'ADMIN' });
      // The snapshot path syncs absent members with no roles; the config still holds them.
      const again = await syncMember(deps, { ...memberInput(90, []), reason: 'not_in_snapshot', at: new Date() });
      expect(again).toMatchObject({ level: 'DEVELOPER', status: 'active' });
      expect((await loadActor(deps, devId))!.level).toBe('DEVELOPER');
      expect(await db.select().from(users).where(eq(users.discordId, devId))).toHaveLength(1);
    }));
});

import { SettingsSchema } from '@crystalaid/contracts';
import { DEFAULT_GRANTS } from '@crystalaid/domain';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { seedDefaults } from './seed.js';
import * as t from './schema.js';
import { withTestDb } from './testing.js';

const GUILD = '111111111111111111';

// Postgres error codes
const CHECK = '23514';
const UNIQUE = '23505';
const RAISE = 'P0001';

async function rejectsWith(promise: PromiseLike<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ cause: { code } });
}

let seq = 0;
async function newUser(db: Db) {
  seq += 1;
  const [user] = await db
    .insert(t.users)
    .values({ discordId: `d${seq}-${Date.now()}`, username: `user${seq}` })
    .returning();
  return user!;
}

async function newStaff(db: Db, balance = 0) {
  const user = await newUser(db);
  await db.insert(t.staffMembers).values({ guildId: GUILD, userId: user.id, tokenBalance: balance });
  return user;
}

describe('schema constraints', () => {
  it('rejects a negative token balance', () =>
    withTestDb(async (db) => {
      const user = await newUser(db);
      await rejectsWith(
        db.insert(t.staffMembers).values({ guildId: GUILD, userId: user.id, tokenBalance: -1 }),
        CHECK,
      );
    }));

  it('rejects an unknown level and status', () =>
    withTestDb(async (db) => {
      const user = await newUser(db);
      await rejectsWith(
        db.execute(
          sql`INSERT INTO staff_members (guild_id, user_id, level) VALUES (${GUILD}, ${user.id}, 'OWNER')`,
        ),
        CHECK,
      );
      await rejectsWith(
        db.execute(
          sql`INSERT INTO staff_members (guild_id, user_id, status) VALUES (${GUILD}, ${user.id}, 'gone')`,
        ),
        CHECK,
      );
    }));

  it('rejects a second token_ledger row with the same idempotency key', () =>
    withTestDb(async (db) => {
      const user = await newStaff(db);
      const row = {
        guildId: GUILD,
        userId: user.id,
        type: 'grant' as const,
        amount: 5,
        balanceAfter: 5,
        idempotencyKey: 'manual:req-1',
      };
      await db.insert(t.tokenLedger).values(row);
      await rejectsWith(db.insert(t.tokenLedger).values(row), UNIQUE);
    }));

  it.each([
    ['shifts', t.shifts],
    ['voice sessions', t.voiceSessions],
    ['presence sessions', t.presenceSessions],
  ] as const)('allows one open row per user in %s', (_name, table) =>
    withTestDb(async (db) => {
      const user = await newStaff(db);
      const other = await newStaff(db);
      const row = { guildId: GUILD, userId: user.id };
      await db.insert(table).values(row);
      await db.insert(table).values({ guildId: GUILD, userId: other.id });
      await rejectsWith(db.insert(table).values(row), UNIQUE);
      await db.update(table).set({ endedAt: new Date() }).where(eq(table.userId, user.id));
      await db.insert(table).values(row);
    }),
  );

  it('allows one open ticket per requester and category until it is closed', () =>
    withTestDb(async (db) => {
      const user = await newUser(db);
      const row = { guildId: GUILD, requesterId: user.id, category: 'billing' };
      const [first] = await db.insert(t.tickets).values(row).returning();
      await rejectsWith(db.insert(t.tickets).values(row), UNIQUE);
      await db.insert(t.tickets).values({ ...row, category: 'other' });
      await db
        .update(t.tickets)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(t.tickets.id, first!.id));
      await db.insert(t.tickets).values(row);
    }));

  it('rejects a rating outside 1..5', () =>
    withTestDb(async (db) => {
      const user = await newUser(db);
      await rejectsWith(
        db
          .insert(t.tickets)
          .values({ guildId: GUILD, requesterId: user.id, category: 'a', rating: 6 }),
        CHECK,
      );
    }));

  it('rejects a second payroll period for the same week', () =>
    withTestDb(async (db) => {
      const row = { guildId: GUILD, weekStart: '2026-10-26' };
      await db.insert(t.payrollPeriods).values(row);
      await rejectsWith(db.insert(t.payrollPeriods).values(row), UNIQUE);
      await db.insert(t.payrollPeriods).values({ guildId: '222', weekStart: '2026-10-26' });
    }));

  it('rejects a second payroll line for the same user in a period', () =>
    withTestDb(async (db) => {
      const user = await newStaff(db);
      const [period] = await db
        .insert(t.payrollPeriods)
        .values({ guildId: GUILD, weekStart: '2026-10-26' })
        .returning();
      const line = { guildId: GUILD, periodId: period!.id, userId: user.id, calculatedAmount: 10 };
      await db.insert(t.payrollLines).values(line);
      await rejectsWith(db.insert(t.payrollLines).values(line), UNIQUE);
    }));

  it('stores staff_daily by date and rejects a duplicate day', () =>
    withTestDb(async (db) => {
      const user = await newStaff(db);
      const row = { guildId: GUILD, userId: user.id, day: '2026-11-01' };
      await db.insert(t.staffDaily).values(row);
      await rejectsWith(db.insert(t.staffDaily).values(row), UNIQUE);
      const [stored] = await db.select().from(t.staffDaily);
      expect(stored!.day).toBe('2026-11-01');
    }));

  it('keeps bigint balances as numbers', () =>
    withTestDb(async (db) => {
      const user = await newStaff(db, 123456);
      const [member] = await db
        .select()
        .from(t.staffMembers)
        .where(eq(t.staffMembers.userId, user.id));
      expect(member!.tokenBalance).toBe(123456);
    }));
});

describe('append-only tables', () => {
  it('rejects UPDATE and DELETE on audit_log', () =>
    withTestDb(async (db) => {
      await db.insert(t.auditLog).values({ guildId: GUILD, action: 'x', data: { a: 1 } });
      await rejectsWith(db.update(t.auditLog).set({ action: 'y' }), RAISE);
      await rejectsWith(db.delete(t.auditLog), RAISE);
      expect(await db.select().from(t.auditLog)).toHaveLength(1);
    }));

  it('rejects UPDATE and DELETE on token_ledger', () =>
    withTestDb(async (db) => {
      const user = await newStaff(db);
      await db.insert(t.tokenLedger).values({
        guildId: GUILD,
        userId: user.id,
        type: 'grant',
        amount: 5,
        balanceAfter: 5,
        idempotencyKey: 'k1',
      });
      await rejectsWith(db.update(t.tokenLedger).set({ amount: 6 }), RAISE);
      await rejectsWith(db.delete(t.tokenLedger), RAISE);
    }));

  it('is emptied between tests by withTestDb', () =>
    withTestDb(async (db) => {
      expect(await db.select().from(t.auditLog)).toHaveLength(0);
      expect(await db.select().from(t.tokenLedger)).toHaveLength(0);
    }));
});

describe('seedDefaults', () => {
  it('writes settings and default grants, and is idempotent', () =>
    withTestDb(async (db) => {
      await seedDefaults(db, GUILD);
      await seedDefaults(db, GUILD);

      const settingsRows = await db.select().from(t.settings);
      expect(settingsRows).toHaveLength(1);
      expect(settingsRows[0]!.data).toEqual(SettingsSchema.parse({}));

      const grants = await db.select().from(t.rolePermissions);
      const expected = Object.entries(DEFAULT_GRANTS).flatMap(([level, perms]) =>
        perms.map((permission) => `${level}:${permission}`),
      );
      expect(grants.map((g) => `${g.level}:${g.permission}`).sort()).toEqual(expected.sort());
      expect(grants.every((g) => g.guildId === GUILD && g.amountLimit === null)).toBe(true);
    }));

  it('does not overwrite existing rows', () =>
    withTestDb(async (db) => {
      await db.insert(t.settings).values({ guildId: GUILD, data: { ticketRate: 99 } });
      await db
        .insert(t.rolePermissions)
        .values({ guildId: GUILD, level: 'CURATOR', permission: 'staff.note', amountLimit: 7 });
      await seedDefaults(db, GUILD);

      const [row] = await db.select().from(t.settings);
      expect(row!.data).toEqual({ ticketRate: 99 });
      const [note] = await db
        .select()
        .from(t.rolePermissions)
        .where(eq(t.rolePermissions.permission, 'staff.note'));
      expect(note!.amountLimit).toBe(7);
    }));
});

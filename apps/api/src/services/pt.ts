import { and, asc, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import type { ServerConfig } from '@crystalaid/config';
import { AppError } from '@crystalaid/contracts';
import { ptSlots, staffMembers, users, type Db } from '@crystalaid/database';
import { hasPermission } from '@crystalaid/domain';
import type { StaffActor } from './actor.js';
import { writeAudit } from './audit.js';
import { dayBounds, hourStart } from './time.js';

export interface PtDeps {
  db: Db;
  config: ServerConfig;
}

export interface PtSlot {
  startsAt: Date;
  discordId: string;
  username: string;
}

export const REMINDER_LEAD_MS = 5 * 60_000;

function requireShiftEditor(actor: StaffActor): void {
  if (!hasPermission(actor.level, 'shifts.edit', actor.grants)) {
    throw new AppError('FORBIDDEN', 'Not allowed', 403);
  }
}

function requireWholeHour(deps: PtDeps, startsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || hourStart(startsAt, deps.config.timezone).getTime() !== startsAt.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'A duty slot must start on the hour', 400, 'not_whole_hour');
  }
}

/** Puts a support on duty for the hour starting at `startsAt`. Repeating it changes nothing. */
export async function setSlot(
  deps: PtDeps,
  actor: StaffActor,
  input: { startsAt: Date; discordUserId: string },
): Promise<{ created: boolean }> {
  const { db, config } = deps;
  requireShiftEditor(actor);
  requireWholeHour(deps, input.startsAt);
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ userId: users.id, level: staffMembers.level, status: staffMembers.status })
      .from(users)
      .innerJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.guildId, config.guildId)))
      .where(eq(users.discordId, input.discordUserId));
    if (!target || target.status !== 'active' || target.level === 'NONE') {
      throw new AppError('VALIDATION_ERROR', 'The user is not staff', 400, 'not_staff');
    }
    const [row] = await tx
      .insert(ptSlots)
      .values({ guildId: config.guildId, startsAt: input.startsAt, userId: target.userId })
      .onConflictDoNothing()
      .returning({ id: ptSlots.id });
    if (row) {
      await writeAudit(tx, {
        guildId: config.guildId,
        actorUserId: actor.userId,
        action: 'pt.set',
        targetUserId: target.userId,
        data: { startsAt: input.startsAt.toISOString() },
      });
    }
    return { created: !!row };
  });
}

export async function removeSlot(
  deps: PtDeps,
  actor: StaffActor,
  input: { startsAt: Date; discordUserId: string },
): Promise<void> {
  const { db, config } = deps;
  requireShiftEditor(actor);
  requireWholeHour(deps, input.startsAt);
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.discordId, input.discordUserId));
    const [removed] = target
      ? await tx
          .delete(ptSlots)
          .where(
            and(
              eq(ptSlots.guildId, config.guildId),
              eq(ptSlots.startsAt, input.startsAt),
              eq(ptSlots.userId, target.id),
            ),
          )
          .returning({ id: ptSlots.id })
      : [];
    if (!removed) throw new AppError('NOT_FOUND', 'Not found', 404);
    await writeAudit(tx, {
      guildId: config.guildId,
      actorUserId: actor.userId,
      action: 'pt.removed',
      targetUserId: target!.id,
      data: { startsAt: input.startsAt.toISOString() },
    });
  });
}

/** Slots of the local day `date` (`YYYY-MM-DD`, configured timezone), by hour. */
export async function listSlots(deps: PtDeps, date: string): Promise<PtSlot[]> {
  const { db, config } = deps;
  const { start, end } = dayBounds(date, config.timezone);
  return db
    .select({ startsAt: ptSlots.startsAt, discordId: users.discordId, username: users.username })
    .from(ptSlots)
    .innerJoin(users, eq(users.id, ptSlots.userId))
    .where(and(eq(ptSlots.guildId, config.guildId), gte(ptSlots.startsAt, start), lt(ptSlots.startsAt, end)))
    .orderBy(asc(ptSlots.startsAt), asc(users.username));
}

/**
 * Slots starting within the next 5 minutes that have not been reminded. One UPDATE marks and
 * returns them, so parallel callers never get the same slot twice.
 */
export async function dueReminders(deps: PtDeps, now: Date = new Date()): Promise<PtSlot[]> {
  const { db, config } = deps;
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(ptSlots)
      .set({ remindedAt: now })
      .where(
        and(
          eq(ptSlots.guildId, config.guildId),
          isNull(ptSlots.remindedAt),
          gte(ptSlots.startsAt, now),
          lte(ptSlots.startsAt, new Date(now.getTime() + REMINDER_LEAD_MS)),
        ),
      )
      .returning({ startsAt: ptSlots.startsAt, userId: ptSlots.userId });
    const out: PtSlot[] = [];
    for (const m of marked) {
      const [u] = await tx.select().from(users).where(eq(users.id, m.userId));
      out.push({ startsAt: m.startsAt, discordId: u!.discordId, username: u!.username });
      await writeAudit(tx, {
        guildId: config.guildId,
        actorUserId: null,
        action: 'pt.reminded',
        targetUserId: m.userId,
        data: { startsAt: m.startsAt.toISOString() },
      });
    }
    return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  });
}

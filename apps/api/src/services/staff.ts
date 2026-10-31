import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ServerConfig } from '@crystalaid/config';
import type { BotEvent } from '@crystalaid/contracts';
import { resolveLevel } from '@crystalaid/domain';
import { careerEvents, staffMembers, users, type Db } from '@crystalaid/database';
import type { Logger } from '../log.js';
import { writeAudit, type Tx } from './audit.js';

export type StaffMember = typeof staffMembers.$inferSelect;
export type SnapshotEvent = Extract<BotEvent, { type: 'member.snapshot' }>;

export interface StaffDeps {
  db: Db;
  config: ServerConfig;
}

export interface SyncInput {
  /** Discord user id. */
  userId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
  /** When the event happened. An event older than the newest one applied is skipped. */
  at: Date;
  /** Audit reason when this sync deactivates the member. Defaults to `level_changed`. */
  reason?: string;
}

const SNAPSHOT_TTL_SECONDS = 3600;
const SNAPSHOT_LOCK_SECONDS = 60;

async function deactivate(
  tx: Tx,
  staff: StaffMember,
  at: Date,
  reason: string,
): Promise<StaffMember> {
  const [row] = await tx
    .update(staffMembers)
    .set({ status: 'inactive', lastEventAt: at })
    .where(eq(staffMembers.id, staff.id))
    .returning();
  await tx.insert(careerEvents).values({
    guildId: staff.guildId,
    userId: staff.userId,
    type: 'deactivated',
    actorUserId: null,
    data: { level: staff.level, reason },
    createdAt: at,
  });
  await writeAudit(tx, {
    guildId: staff.guildId,
    actorUserId: null,
    action: 'staff.deactivated',
    targetUserId: staff.userId,
    reason,
    data: { level: staff.level },
  });
  return row!;
}

async function recordChange(
  tx: Tx,
  staff: { guildId: string; userId: string },
  type: 'joined' | 'reactivated' | 'level_changed',
  at: Date,
  data: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  await tx.insert(careerEvents).values({
    guildId: staff.guildId,
    userId: staff.userId,
    type,
    actorUserId: null,
    data,
    createdAt: at,
  });
  await writeAudit(tx, {
    guildId: staff.guildId,
    actorUserId: null,
    action: `staff.${type}`,
    targetUserId: staff.userId,
    reason,
    data,
  });
}

const isStale = (staff: StaffMember, at: Date) => staff.lastEventAt !== null && at < staff.lastEventAt;

/**
 * Brings the staff record in line with the member's current Discord roles. Idempotent: a repeat
 * with the same roles changes nothing and writes no log. An event older than `last_event_at`
 * (a retry that arrives after a newer one) is skipped. Returns null when the member has no
 * access and no staff record.
 */
export async function syncMember(deps: StaffDeps, input: SyncInput): Promise<StaffMember | null> {
  const { db, config } = deps;
  const guildId = config.guildId;
  const level = resolveLevel(input.roleIds, config.roles);

  return db.transaction(async (tx) => {
    let [user] = await tx.select().from(users).where(eq(users.discordId, input.userId));
    let staff: StaffMember | undefined;
    if (user) {
      [staff] = await tx
        .select()
        .from(staffMembers)
        .where(and(eq(staffMembers.guildId, guildId), eq(staffMembers.userId, user.id)))
        .for('update');
    }
    if (staff && isStale(staff, input.at)) return staff;
    if (level === 'NONE' && !staff) return null;

    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ discordId: input.userId, username: input.username, avatar: input.avatar })
        .returning();
    } else if (user.username !== input.username || user.avatar !== input.avatar) {
      await tx
        .update(users)
        .set({ username: input.username, avatar: input.avatar })
        .where(eq(users.id, user.id));
    }
    const userId = user!.id;

    if (!staff) {
      const [row] = await tx
        .insert(staffMembers)
        .values({ guildId, userId, level, status: 'active', joinedAt: input.at, lastEventAt: input.at })
        .returning();
      await recordChange(tx, { guildId, userId }, 'joined', input.at, { level });
      return row!;
    }

    if (level === 'NONE') {
      if (staff.status === 'active') return deactivate(tx, staff, input.at, input.reason ?? 'level_changed');
    } else if (staff.status === 'inactive') {
      const [row] = await tx
        .update(staffMembers)
        .set({ status: 'active', level, lastEventAt: input.at })
        .where(eq(staffMembers.id, staff.id))
        .returning();
      await recordChange(tx, staff, 'reactivated', input.at, { level, previousLevel: staff.level });
      return row!;
    } else if (staff.level !== level) {
      const [row] = await tx
        .update(staffMembers)
        .set({ level, lastEventAt: input.at })
        .where(eq(staffMembers.id, staff.id))
        .returning();
      await recordChange(
        tx,
        staff,
        'level_changed',
        input.at,
        { from: staff.level, to: level },
        'level_changed',
      );
      return row!;
    }

    // Nothing to change except remembering how fresh our knowledge is.
    if (staff.lastEventAt === null || staff.lastEventAt < input.at) {
      const [row] = await tx
        .update(staffMembers)
        .set({ lastEventAt: input.at })
        .where(eq(staffMembers.id, staff.id))
        .returning();
      return row!;
    }
    return staff;
  });
}

/** The member left the guild: close access, keep history and balance. Stale events are skipped. */
export async function removeMember(deps: StaffDeps, userId: string, at: Date): Promise<void> {
  const { db, config } = deps;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ staff: staffMembers })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(users.discordId, userId)))
      .for('update');
    if (!row || isStale(row.staff, at)) return;
    if (row.staff.status === 'inactive') {
      await tx.update(staffMembers).set({ lastEventAt: at }).where(eq(staffMembers.id, row.staff.id));
      return;
    }
    await deactivate(tx, row.staff, at, 'member_removed');
  });
}

/**
 * One part of a full member list (`part` of `parts`, any arrival order). A part's ids are
 * recorded in Redis only after all its members were synced, together with its part number, in
 * one MULTI. When every part is recorded, one worker (guarded by a lock) deactivates active staff
 * missing from the combined set. A failed or missing part therefore never deactivates anyone.
 * The keys are never deleted; they expire after an hour, and `applied` stops a redelivered part
 * from running the deactivation again. If the lock is held the call throws so the entry is retried.
 */
export async function applySnapshot(
  deps: StaffDeps & { redis: Redis; log: Logger },
  event: SnapshotEvent,
): Promise<void> {
  const { db, redis, config, log } = deps;
  const base = `snapshot:${event.snapshotId}`;
  const membersKey = `${base}:members`;
  const doneKey = `${base}:done`;
  const lockKey = `${base}:lock`;
  const appliedKey = `${base}:applied`;
  const at = new Date(event.at);

  if (await redis.exists(appliedKey)) {
    log.info('snapshot already applied, part ignored', { snapshotId: event.snapshotId, part: event.part });
    return;
  }

  for (const m of event.members) {
    await syncMember({ db, config }, { ...m, at });
  }

  const multi = redis.multi();
  if (event.members.length > 0) multi.sadd(membersKey, ...event.members.map((m) => m.userId));
  multi.sadd(doneKey, String(event.part));
  multi.expire(membersKey, SNAPSHOT_TTL_SECONDS);
  multi.expire(doneKey, SNAPSHOT_TTL_SECONDS);
  const results = (await multi.exec()) ?? [];
  const failed = results.find(([err]) => err);
  if (failed?.[0]) throw failed[0];

  const doneCount = await redis.scard(doneKey);
  if (doneCount < event.parts) {
    log.info('snapshot part recorded, waiting for the rest', {
      snapshotId: event.snapshotId,
      received: doneCount,
      parts: event.parts,
    });
    return;
  }

  const locked = await redis.set(lockKey, '1', 'EX', SNAPSHOT_LOCK_SECONDS, 'NX');
  if (locked !== 'OK') throw new Error(`snapshot ${event.snapshotId} is being applied by another worker`);
  if (await redis.exists(appliedKey)) return;

  const present = new Set(await redis.smembers(membersKey));
  if (present.size === 0) {
    log.warn('empty member snapshot, nobody deactivated', { snapshotId: event.snapshotId });
  } else {
    const active = await db
      .select({ discordId: users.discordId, username: users.username, avatar: users.avatar })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.status, 'active')));
    for (const u of active) {
      if (present.has(u.discordId)) continue;
      // A newer event for this member makes syncMember skip the stale snapshot view.
      await syncMember(
        { db, config },
        { userId: u.discordId, username: u.username, avatar: u.avatar, roleIds: [], at, reason: 'not_in_snapshot' },
      );
    }
  }
  await redis.set(appliedKey, '1', 'EX', SNAPSHOT_TTL_SECONDS);
}

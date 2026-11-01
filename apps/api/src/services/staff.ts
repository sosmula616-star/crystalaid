import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ServerConfig } from '@crystalaid/config';
import type { BotEvent } from '@crystalaid/contracts';
import { resolveLevel } from '@crystalaid/domain';
import { careerEvents, staffMembers, users, type Db } from '@crystalaid/database';
import type { Logger } from '../log.js';
import { writeAudit, type Tx } from './audit.js';
import { releaseClaimedBy } from './tickets.js';

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
/** A snapshot may deactivate more than half of the active staff only below this many people. */
const SNAPSHOT_MASS_DEACTIVATION_MIN = 3;

async function deactivate(
  tx: Tx,
  staff: StaffMember,
  at: Date,
  reason: string,
  supportRoleMissing = false,
): Promise<StaffMember> {
  // An inactive row has no level; the level it had stays in the career event and the audit row.
  const [row] = await tx
    .update(staffMembers)
    .set({ status: 'inactive', level: 'NONE', lastEventAt: at })
    .where(eq(staffMembers.id, staff.id))
    .returning();
  await tx.insert(careerEvents).values({
    guildId: staff.guildId,
    userId: staff.userId,
    type: 'deactivated',
    actorUserId: null,
    data: { level: staff.level, reason, ...(supportRoleMissing ? { supportRoleMissing } : {}) },
    createdAt: at,
  });
  await writeAudit(tx, {
    guildId: staff.guildId,
    actorUserId: null,
    action: 'staff.deactivated',
    targetUserId: staff.userId,
    reason,
    data: { level: staff.level, ...(supportRoleMissing ? { supportRoleMissing } : {}) },
  });
  // A ticket in work must not stay with someone who has no access: it goes back to the queue.
  await releaseClaimedBy(tx, staff.guildId, staff.userId, at);
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
  const level = resolveLevel(input.roleIds, config.roles, input.userId, config.users);

  return db.transaction(async (tx) => {
    const selectStaff = (userId: string) =>
      tx
        .select()
        .from(staffMembers)
        .where(and(eq(staffMembers.guildId, guildId), eq(staffMembers.userId, userId)))
        .for('update')
        .then((rows) => rows[0]);

    let [user] = await tx.select().from(users).where(eq(users.discordId, input.userId));
    let staff: StaffMember | undefined;
    if (user) staff = await selectStaff(user.id);
    if (staff && isStale(staff, input.at)) return staff;
    if (level === 'NONE' && !staff) return null;

    if (!user) {
      // Two first syncs of one person can race; the loser of the insert reads the winner's row.
      [user] = await tx
        .insert(users)
        .values({ discordId: input.userId, username: input.username, avatar: input.avatar })
        .onConflictDoNothing()
        .returning();
      if (!user) [user] = await tx.select().from(users).where(eq(users.discordId, input.userId));
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
        .onConflictDoNothing()
        .returning();
      if (row) {
        await recordChange(tx, { guildId, userId }, 'joined', input.at, { level });
        return row;
      }
      // A parallel first sync created the row; carry on as for an existing member.
      staff = await selectStaff(userId);
      if (!staff) throw new Error('staff record vanished during first sync');
      if (isStale(staff, input.at)) return staff;
    }

    if (level === 'NONE') {
      if (staff.status === 'active') {
        const supportRoleMissing =
          !input.roleIds.some((id) => config.roles.support.includes(id)) &&
          input.roleIds.some((id) => config.roles.curator.includes(id));
        return deactivate(tx, staff, input.at, input.reason ?? 'level_changed', supportRoleMissing);
      }
    } else if (staff.status === 'inactive') {
      const [row] = await tx
        .update(staffMembers)
        .set({ status: 'active', level, lastEventAt: input.at })
        .where(eq(staffMembers.id, staff.id))
        .returning();
      await recordChange(tx, staff, 'reactivated', input.at, { level });
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
 * The first part fixes `parts` (`snapshot:<id>:parts`, same TTL); a later part with a different
 * `parts` is refused and logged. A snapshot that would deactivate more than half of the active
 * staff and at least 3 people is not applied: an error is logged and nobody is deactivated.
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
  const atKey = `${base}:at`;
  const lockKey = `${base}:lock`;
  const appliedKey = `${base}:applied`;
  const partsKey = `${base}:parts`;
  const at = new Date(event.at);

  if (await redis.exists(appliedKey)) {
    log.info('snapshot already applied, part ignored', { snapshotId: event.snapshotId, part: event.part });
    return;
  }

  // The first part to arrive fixes the part count; a part that disagrees is refused unrecorded.
  const first = await redis.set(partsKey, String(event.parts), 'EX', SNAPSHOT_TTL_SECONDS, 'NX');
  if (first !== 'OK') {
    const expected = await redis.get(partsKey);
    if (expected !== String(event.parts)) {
      log.error('snapshot part disagrees with the part count of an earlier part, part refused', {
        snapshotId: event.snapshotId,
        part: event.part,
        parts: event.parts,
        expectedParts: expected,
      });
      return;
    }
  }

  for (const m of event.members) {
    await syncMember({ db, config }, { ...m, at });
  }

  const multi = redis.multi();
  if (event.members.length > 0) multi.sadd(membersKey, ...event.members.map((m) => m.userId));
  multi.sadd(doneKey, String(event.part));
  multi.expire(membersKey, SNAPSHOT_TTL_SECONDS);
  multi.zadd(atKey, at.getTime(), String(event.part));
  multi.expire(doneKey, SNAPSHOT_TTL_SECONDS);
  multi.expire(atKey, SNAPSHOT_TTL_SECONDS);
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
  try {
    if (await redis.exists(appliedKey)) return;

    // `at` is when enumeration started, so the earliest stamp over all parts is the cut-off:
    // any member event after it is newer than what the snapshot may have seen.
    const [, earliest] = await redis.zrange(atKey, 0, 0, 'WITHSCORES');
    const startedAt = earliest === undefined ? at : new Date(Number(earliest));

    const present = new Set(await redis.smembers(membersKey));
    if (present.size === 0) {
      log.warn('empty member snapshot, nobody deactivated', { snapshotId: event.snapshotId });
    } else {
      const active = await db
        .select({ discordId: users.discordId, username: users.username, avatar: users.avatar })
        .from(staffMembers)
        .innerJoin(users, eq(users.id, staffMembers.userId))
        .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.status, 'active')));
      const missing = active.filter((u) => !present.has(u.discordId));
      if (missing.length >= SNAPSHOT_MASS_DEACTIVATION_MIN && missing.length * 2 > active.length) {
        // A truncated but complete-looking snapshot would otherwise close everyone's access.
        log.error('snapshot would deactivate more than half of the active staff, deactivation refused', {
          snapshotId: event.snapshotId,
          wouldDeactivate: missing.length,
          active: active.length,
        });
        missing.length = 0;
      }
      for (const u of missing) {
        // A newer event for this member makes syncMember skip the stale snapshot view.
        await syncMember(
          { db, config },
          {
            userId: u.discordId,
            username: u.username,
            avatar: u.avatar,
            roleIds: [],
            at: startedAt,
            reason: 'not_in_snapshot',
          },
        );
      }
    }
    await redis.set(appliedKey, '1', 'EX', SNAPSHOT_TTL_SECONDS);
  } finally {
    // Release at once so a retry does not wait for the lock to expire; `applied` guards repeats.
    await redis.del(lockKey);
  }
}

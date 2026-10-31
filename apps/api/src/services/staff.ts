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
  at: Date;
  /** Audit reason when this sync deactivates the member. Defaults to `level_changed`. */
  reason?: string;
}

const SNAPSHOT_TTL_SECONDS = 3600;

async function deactivate(
  tx: Tx,
  staff: StaffMember,
  at: Date,
  reason: string,
): Promise<StaffMember> {
  const [row] = await tx
    .update(staffMembers)
    .set({ status: 'inactive' })
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

/**
 * Brings the staff record in line with the member's current Discord roles. Idempotent: a repeat
 * with the same roles changes nothing and writes no log. Returns null when the member has no
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
        .values({ guildId, userId, level, status: 'active', joinedAt: input.at })
        .returning();
      await recordChange(tx, { guildId, userId }, 'joined', input.at, { level });
      return row!;
    }

    if (level === 'NONE') {
      if (staff.status === 'inactive') return staff;
      return deactivate(tx, staff, input.at, input.reason ?? 'level_changed');
    }

    if (staff.status === 'inactive') {
      const [row] = await tx
        .update(staffMembers)
        .set({ status: 'active', level })
        .where(eq(staffMembers.id, staff.id))
        .returning();
      await recordChange(tx, staff, 'reactivated', input.at, { level, previousLevel: staff.level });
      return row!;
    }

    if (staff.level !== level) {
      const [row] = await tx
        .update(staffMembers)
        .set({ level })
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
    return staff;
  });
}

/** The member left the guild: close access, keep history and balance. */
export async function removeMember(deps: StaffDeps, userId: string, at: Date): Promise<void> {
  const { db, config } = deps;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ staff: staffMembers })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(and(eq(staffMembers.guildId, config.guildId), eq(users.discordId, userId)))
      .for('update');
    if (!row || row.staff.status === 'inactive') return;
    await deactivate(tx, row.staff, at, 'member_removed');
  });
}

/**
 * One part of a full member list. Ids are collected in Redis; members missing from the whole
 * snapshot are deactivated only once the final part arrives, and never from an empty set.
 */
export async function applySnapshot(
  deps: StaffDeps & { redis: Redis; log: Logger },
  event: SnapshotEvent,
): Promise<void> {
  const { db, redis, config, log } = deps;
  const key = `snapshot:${event.snapshotId}`;
  const at = new Date(event.at);

  for (const m of event.members) {
    await syncMember({ db, config }, { ...m, at });
  }
  if (event.members.length > 0) {
    await redis.sadd(key, ...event.members.map((m) => m.userId));
    await redis.expire(key, SNAPSHOT_TTL_SECONDS);
  }
  if (!event.final) return;

  const present = new Set(await redis.smembers(key));
  if (present.size === 0) {
    log.warn('empty member snapshot, nobody deactivated', { snapshotId: event.snapshotId });
    return;
  }
  const active = await db
    .select({ discordId: users.discordId, username: users.username, avatar: users.avatar })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.guildId, config.guildId), eq(staffMembers.status, 'active')));
  for (const u of active) {
    if (present.has(u.discordId)) continue;
    await syncMember(
      { db, config },
      { userId: u.discordId, username: u.username, avatar: u.avatar, roleIds: [], at, reason: 'not_in_snapshot' },
    );
  }
  await redis.del(key);
}

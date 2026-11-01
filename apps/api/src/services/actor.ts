import { and, eq } from 'drizzle-orm';
import type { ServerConfig } from '@crystalaid/config';
import { AppError } from '@crystalaid/contracts';
import { staffMembers, users, type Db } from '@crystalaid/database';
import { LEVEL_RANK, atLeast, resolveLevel, type Level, type Permission } from '@crystalaid/domain';
import { getGrants } from './permissions.js';

/** A staff member as the services see them. Read from the database on every call. */
export interface StaffActor {
  userId: string;
  discordId: string;
  level: Level;
  grants: Permission[];
}

/**
 * The current level of a Discord user: the active staff record, raised to the level the config
 * gives their id. Null when there is no users row or the level is NONE.
 */
export async function loadActor(
  deps: { db: Db; config: ServerConfig },
  discordId: string,
): Promise<StaffActor | null> {
  const { db, config } = deps;
  const [row] = await db
    .select({ userId: users.id, level: staffMembers.level, status: staffMembers.status })
    .from(users)
    .leftJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.guildId, config.guildId)))
    .where(eq(users.discordId, discordId));
  if (!row) return null;
  const stored: Level = row.status === 'active' && row.level ? row.level : 'NONE';
  const fromConfig = resolveLevel([], config.roles, discordId, config.users);
  const level = LEVEL_RANK[fromConfig] > LEVEL_RANK[stored] ? fromConfig : stored;
  if (level === 'NONE') return null;
  return { userId: row.userId, discordId, level, grants: await getGrants(db, config.guildId, level) };
}

/** Like `loadActor`, but refuses unless the actor has at least `min`. */
export async function requireActor(
  deps: { db: Db; config: ServerConfig },
  discordId: string,
  min: Level,
): Promise<StaffActor> {
  const actor = await loadActor(deps, discordId);
  if (!actor) throw new AppError('NOT_STAFF', 'No access', 403, 'not_in_branch');
  if (!atLeast(actor.level, min)) throw new AppError('FORBIDDEN', 'Not allowed', 403);
  return actor;
}

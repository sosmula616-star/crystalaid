import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '@crystalaid/contracts';
import { PERMISSIONS, atLeast, type Level, type Permission } from '@crystalaid/domain';
import { rolePermissions, seedDefaults, settings, type Db } from '@crystalaid/database';
import { writeAudit } from './audit.js';

type GrantLevel = 'SUPPORT' | 'CURATOR';

/** Permissions stored in the database for a level. ADMIN is handled by hasPermission. */
export async function getGrants(db: Db, guildId: string, level: Level): Promise<Permission[]> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.guildId, guildId), eq(rolePermissions.level, level)));
  return rows.map((r) => r.permission as Permission);
}

/**
 * Replaces the grants of SUPPORT or CURATOR in `guildId` (the configured guild, passed by the
 * caller). Only ADMIN may do this. Amount limits of permissions that stay granted are kept.
 * Concurrent updates of one guild and level are serialized by an advisory lock held until the
 * transaction ends.
 */
export async function updateGrants(
  db: Db,
  guildId: string,
  actor: { userId: string; level: Level },
  level: GrantLevel,
  grants: Permission[],
): Promise<void> {
  if (!atLeast(actor.level, 'ADMIN')) throw new AppError('FORBIDDEN', 'Only an admin can change permissions', 403);
  if (level !== 'SUPPORT' && level !== 'CURATOR') {
    throw new AppError('VALIDATION_ERROR', 'Permissions can only be set for SUPPORT or CURATOR', 400);
  }
  const unknown = grants.filter((g) => !(PERMISSIONS as readonly string[]).includes(g));
  if (unknown.length > 0) {
    throw new AppError('VALIDATION_ERROR', `Unknown permission: ${unknown.join(', ')}`, 400);
  }
  const wanted = [...new Set(grants)];

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`grants:${guildId}:${level}`}, 0))`);

    const before = await tx
      .select()
      .from(rolePermissions)
      .where(and(eq(rolePermissions.guildId, guildId), eq(rolePermissions.level, level)));
    const limits = new Map(before.map((r) => [r.permission, r.amountLimit]));

    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.guildId, guildId), eq(rolePermissions.level, level)));
    if (wanted.length > 0) {
      await tx.insert(rolePermissions).values(
        wanted.map((permission) => ({
          guildId,
          level,
          permission,
          amountLimit: limits.get(permission) ?? null,
        })),
      );
    }
    await writeAudit(tx, {
      guildId,
      actorUserId: actor.userId,
      action: 'grants.updated',
      data: { level, before: before.map((r) => r.permission).sort(), after: [...wanted].sort() },
    });
  });
}

/**
 * First start of a guild: inserts the spec default settings and grants, but only when the guild
 * has no `settings` row. Later starts do nothing, so grants an admin removed stay removed.
 */
export async function ensureSeeded(db: Db, guildId: string): Promise<void> {
  const [row] = await db.select({ guildId: settings.guildId }).from(settings).where(eq(settings.guildId, guildId));
  if (!row) await seedDefaults(db, guildId);
}

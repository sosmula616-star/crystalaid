import { and, eq } from 'drizzle-orm';
import { AppError } from '@crystalaid/contracts';
import { PERMISSIONS, type Level, type Permission } from '@crystalaid/domain';
import { rolePermissions, staffMembers, type Db } from '@crystalaid/database';
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
 * Replaces the grants of SUPPORT or CURATOR. Only ADMIN may do this. The guild is the one the
 * acting admin belongs to. Amount limits of permissions that stay granted are kept.
 */
export async function updateGrants(
  db: Db,
  actor: { userId: string; level: Level },
  level: GrantLevel,
  grants: Permission[],
): Promise<void> {
  if (actor.level !== 'ADMIN') throw new AppError('FORBIDDEN', 'Only an admin can change permissions', 403);
  if (level !== 'SUPPORT' && level !== 'CURATOR') {
    throw new AppError('VALIDATION_ERROR', 'Permissions can only be set for SUPPORT or CURATOR', 400);
  }
  const unknown = grants.filter((g) => !(PERMISSIONS as readonly string[]).includes(g));
  if (unknown.length > 0) {
    throw new AppError('VALIDATION_ERROR', `Unknown permission: ${unknown.join(', ')}`, 400);
  }
  const wanted = [...new Set(grants)];

  await db.transaction(async (tx) => {
    const [membership] = await tx
      .select({ guildId: staffMembers.guildId })
      .from(staffMembers)
      .where(eq(staffMembers.userId, actor.userId));
    if (!membership) throw new AppError('FORBIDDEN', 'Actor is not a staff member', 403);
    const guildId = membership.guildId;

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

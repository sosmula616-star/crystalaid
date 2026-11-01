import type { ServerConfig } from '@crystalaid/config';

export type Level = 'NONE' | 'SUPPORT' | 'CURATOR' | 'ADMIN' | 'DEVELOPER';

export const LEVEL_RANK: Record<Level, number> = { NONE: 0, SUPPORT: 1, CURATOR: 2, ADMIN: 3, DEVELOPER: 4 };

/** True when `level` is `min` or higher. */
export const atLeast = (level: Level, min: Level): boolean => LEVEL_RANK[level] >= LEVEL_RANK[min];

/**
 * Highest matching level. A user id in `users.developers` is DEVELOPER and one in `users.admins`
 * is ADMIN, whatever roles they hold. Otherwise the roles decide; CURATOR also requires a support role.
 */
export function resolveLevel(
  memberRoleIds: string[],
  roles: ServerConfig['roles'],
  userId: string,
  users: ServerConfig['users'],
): Level {
  if (users.developers.includes(userId)) return 'DEVELOPER';
  if (users.admins.includes(userId)) return 'ADMIN';
  const has = (list: string[]) => memberRoleIds.some((id) => list.includes(id));
  if (has(roles.admin)) return 'ADMIN';
  const support = has(roles.support);
  if (support && has(roles.curator)) return 'CURATOR';
  if (support) return 'SUPPORT';
  return 'NONE';
}

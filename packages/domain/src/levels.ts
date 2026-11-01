import type { ServerConfig } from '@crystalaid/config';

export type Level = 'NONE' | 'SUPPORT' | 'CURATOR' | 'ADMIN';

/** Highest matching level from current Discord roles. CURATOR also requires a support role. */
export function resolveLevel(memberRoleIds: string[], roles: ServerConfig['roles']): Level {
  const has = (list: string[]) => memberRoleIds.some((id) => list.includes(id));
  if (has(roles.admin)) return 'ADMIN';
  const support = has(roles.support);
  if (support && has(roles.curator)) return 'CURATOR';
  if (support) return 'SUPPORT';
  return 'NONE';
}

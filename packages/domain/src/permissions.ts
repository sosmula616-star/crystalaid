import type { Level } from './levels.js';

export const PERMISSIONS = [
  'tickets.view_all',
  'tickets.read_transcript',
  'tickets.transfer',
  'shifts.edit',
  'absences.approve',
  'staff.warn',
  'staff.note',
  'reports.view',
  'payroll.approve',
  'tokens.grant',
  'tokens.deduct',
  'shop.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Spec 3.3 defaults. ADMIN-only permissions are in neither list; ADMIN has everything. */
export const DEFAULT_GRANTS: Record<'SUPPORT' | 'CURATOR', Permission[]> = {
  SUPPORT: [],
  CURATOR: [
    'tickets.view_all',
    'tickets.read_transcript',
    'tickets.transfer',
    'shifts.edit',
    'absences.approve',
    'staff.warn',
    'staff.note',
    'reports.view',
  ],
};

/** `grants` are the permissions stored in the database for the actor's level. */
export function hasPermission(level: Level, permission: Permission, grants: Permission[]): boolean {
  if (level === 'ADMIN' || level === 'DEVELOPER') return true;
  if (level === 'NONE') return false;
  return grants.includes(permission);
}

/** Staff may not change their own balance, shifts or warnings, whatever their permissions. */
export function isSelfAction(actorUserId: string, targetUserId: string): boolean {
  return actorUserId === targetUserId;
}

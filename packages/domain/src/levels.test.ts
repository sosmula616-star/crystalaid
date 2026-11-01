import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '@crystalaid/config';
import { atLeast, resolveLevel } from './levels.js';
import { hasPermission } from './permissions.js';

const SUPPORT_ROLE = '100000000000000001';
const CURATOR_ROLE = '100000000000000002';
const ADMIN_ROLE = '100000000000000003';
const ADMIN_USER = '200000000000000001';
const DEV_USER = '200000000000000002';
const PLAIN_USER = '200000000000000003';

const roles: ServerConfig['roles'] = {
  support: [SUPPORT_ROLE],
  curator: [CURATOR_ROLE],
  admin: [ADMIN_ROLE],
};
const users: ServerConfig['users'] = { admins: [ADMIN_USER], developers: [DEV_USER] };
const level = (r: string[], id = PLAIN_USER) => resolveLevel(r, roles, id, users);

describe('resolveLevel', () => {
  it('maps roles to the highest matching level', () => {
    expect(level([ADMIN_ROLE])).toBe('ADMIN');
    expect(level([CURATOR_ROLE, SUPPORT_ROLE])).toBe('CURATOR');
    expect(level([CURATOR_ROLE])).toBe('NONE');
    expect(level([SUPPORT_ROLE])).toBe('SUPPORT');
    expect(level([])).toBe('NONE');
    expect(level([ADMIN_ROLE, SUPPORT_ROLE])).toBe('ADMIN');
  });

  it('ignores unrelated roles', () => {
    expect(level(['999999999999999999'])).toBe('NONE');
  });

  it('gives ADMIN and DEVELOPER by user id, whatever the roles', () => {
    expect(level([], ADMIN_USER)).toBe('ADMIN');
    expect(level([SUPPORT_ROLE], ADMIN_USER)).toBe('ADMIN');
    expect(level([], DEV_USER)).toBe('DEVELOPER');
    expect(level([ADMIN_ROLE], DEV_USER)).toBe('DEVELOPER');
  });

  it('puts DEVELOPER above ADMIN and lets it hold every permission', () => {
    expect(atLeast('DEVELOPER', 'ADMIN')).toBe(true);
    expect(atLeast('ADMIN', 'DEVELOPER')).toBe(false);
    expect(hasPermission('DEVELOPER', 'payroll.approve', [])).toBe(true);
  });
});

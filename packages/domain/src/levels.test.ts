import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '@crystalaid/config';
import { resolveLevel } from './levels.js';

const SUPPORT_ROLE = '100000000000000001';
const CURATOR_ROLE = '100000000000000002';
const ADMIN_ROLE = '100000000000000003';

const roles: ServerConfig['roles'] = {
  support: [SUPPORT_ROLE],
  curator: [CURATOR_ROLE],
  admin: [ADMIN_ROLE],
};

describe('resolveLevel', () => {
  it('maps roles to the highest matching level', () => {
    expect(resolveLevel([ADMIN_ROLE], roles)).toBe('ADMIN');
    expect(resolveLevel([CURATOR_ROLE, SUPPORT_ROLE], roles)).toBe('CURATOR');
    expect(resolveLevel([CURATOR_ROLE], roles)).toBe('NONE');
    expect(resolveLevel([SUPPORT_ROLE], roles)).toBe('SUPPORT');
    expect(resolveLevel([], roles)).toBe('NONE');
    expect(resolveLevel([ADMIN_ROLE, SUPPORT_ROLE], roles)).toBe('ADMIN');
  });

  it('ignores unrelated roles', () => {
    expect(resolveLevel(['999999999999999999'], roles)).toBe('NONE');
  });
});

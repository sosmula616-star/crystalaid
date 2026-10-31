import { describe, expect, it } from 'vitest';
import { DEFAULT_GRANTS, PERMISSIONS, hasPermission, isSelfAction } from './permissions.js';

describe('permissions', () => {
  it('defines the 12 permissions', () => {
    expect(PERMISSIONS).toHaveLength(12);
  });

  it('has the spec default grants', () => {
    expect(DEFAULT_GRANTS.CURATOR).toContain('shifts.edit');
    expect(DEFAULT_GRANTS.CURATOR).not.toContain('tokens.grant');
    expect(DEFAULT_GRANTS.CURATOR).toEqual([
      'tickets.view_all',
      'tickets.read_transcript',
      'tickets.transfer',
      'shifts.edit',
      'absences.approve',
      'staff.warn',
      'staff.note',
      'reports.view',
    ]);
    expect(DEFAULT_GRANTS.SUPPORT).toEqual([]);
  });

  it('keeps admin-only permissions out of both default lists', () => {
    for (const p of ['payroll.approve', 'tokens.grant', 'tokens.deduct', 'shop.manage'] as const) {
      expect(DEFAULT_GRANTS.CURATOR).not.toContain(p);
      expect(DEFAULT_GRANTS.SUPPORT).not.toContain(p);
    }
  });

  it('hasPermission: ADMIN always, NONE never, others by grants', () => {
    expect(hasPermission('ADMIN', 'tokens.grant', [])).toBe(true);
    expect(hasPermission('CURATOR', 'tokens.grant', [])).toBe(false);
    expect(hasPermission('NONE', 'reports.view', ['reports.view'])).toBe(false);
    expect(hasPermission('CURATOR', 'reports.view', ['reports.view'])).toBe(true);
    expect(hasPermission('SUPPORT', 'reports.view', [])).toBe(false);
  });

  it('isSelfAction compares user ids', () => {
    expect(isSelfAction('u1', 'u1')).toBe(true);
    expect(isSelfAction('u1', 'u2')).toBe(false);
  });
});

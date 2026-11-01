import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@crystalaid/contracts';
import { SECTIONS, visibleSections } from './sections.js';

type Permission = MeResponse['permissions'][number];

const CURATOR_GRANTS: Permission[] = ['tickets.view_all', 'reports.view'];
const ids = (list: readonly { id: string }[]) => list.map((s) => s.id);

describe('visibleSections', () => {
  it('gives SUPPORT the six base sections in table order', () => {
    expect(ids(visibleSections('SUPPORT', []))).toEqual(['overview', 'shift', 'tickets', 'stats', 'shop', 'settings']);
  });

  it('adds roster, roster shifts, all tickets and reports for a CURATOR with the default grants', () => {
    expect(ids(visibleSections('CURATOR', CURATOR_GRANTS))).toEqual([
      'overview',
      'shift',
      'tickets',
      'stats',
      'shop',
      'settings',
      'staff',
      'staffShifts',
      'allTickets',
      'reports',
    ]);
  });

  it('hides permission-gated sections from a CURATOR who lacks the permission', () => {
    expect(ids(visibleSections('CURATOR', []))).toEqual([
      'overview',
      'shift',
      'tickets',
      'stats',
      'shop',
      'settings',
      'staff',
      'staffShifts',
    ]);
  });

  it('gives an ADMIN everything without listing permissions', () => {
    const admin = visibleSections('ADMIN', []);
    expect(ids(admin)).toEqual(ids(SECTIONS));
    expect(admin).toHaveLength(15);
    expect(ids(admin).slice(10)).toEqual(['roles', 'payroll', 'norms', 'shopManage', 'audit']);
  });

  it('gives NONE nothing, whatever the permissions', () => {
    expect(visibleSections('NONE', ['reports.view', 'payroll.approve'])).toEqual([]);
  });

  it('does not let a permission lift a section above its level', () => {
    expect(ids(visibleSections('SUPPORT', ['payroll.approve', 'shop.manage']))).toHaveLength(6);
  });

  it('gives every section a unique id and a loader', () => {
    expect(new Set(ids(SECTIONS)).size).toBe(SECTIONS.length);
    for (const section of SECTIONS) expect(typeof section.load).toBe('function');
  });
});

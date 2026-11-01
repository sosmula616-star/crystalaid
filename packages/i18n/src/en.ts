import type { MessageKey } from './ru.js';

// Record<MessageKey, string> makes a missing or extra key a type error.
export const en: Record<MessageKey, string> = {
  'nav.overview': 'Overview',
  'nav.shift': 'Shift',
  'nav.tickets': 'Tickets',
  'nav.stats': 'Statistics',
  'nav.store': 'Store',
  'nav.settings': 'Settings',
  'nav.roster': 'Roster',
  'nav.rosterShifts': 'Roster shifts',
  'nav.allTickets': 'All tickets',
  'nav.reports': 'Reports',
  'nav.roles': 'Roles and access',
  'nav.payroll': 'Payroll',
  'nav.quotas': 'Quotas',
  'nav.storeAdmin': 'Store management',
  'nav.auditLog': 'Audit log',
  'theme.crystal': 'Crystal',
  'theme.indigo': 'Indigo',
  'theme.amber': 'Amber',
  'theme.emerald': 'Emerald',
  'theme.graphite': 'Graphite',
  'theme.raspberry': 'Raspberry',
};

import type { ComponentType } from 'react';
import {
  CalendarClock,
  ChartColumn,
  Clock,
  FileText,
  Gauge,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import type { MeResponse } from '@crystalaid/contracts';
import type { MessageKey } from '@crystalaid/i18n';

export type Level = MeResponse['level'];
export type Permission = MeResponse['permissions'][number];

export type SectionId =
  | 'overview'
  | 'shift'
  | 'tickets'
  | 'stats'
  | 'shop'
  | 'settings'
  | 'staff'
  | 'staffShifts'
  | 'allTickets'
  | 'reports'
  | 'roles'
  | 'payroll'
  | 'norms'
  | 'shopManage'
  | 'audit';

export interface Section {
  id: SectionId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** The lowest level that sees the section. It also decides the navigation group. */
  minLevel: Exclude<Level, 'NONE'>;
  /** Also required below ADMIN. ADMIN holds every permission. */
  permission?: Permission;
  load(): Promise<{ default: ComponentType }>;
}

const RANK: Record<Level, number> = { NONE: 0, SUPPORT: 1, CURATOR: 2, ADMIN: 3, DEVELOPER: 4 };

/** Navigation groups, in display order. A section belongs to the group of its `minLevel`. */
export const GROUPS = ['SUPPORT', 'CURATOR', 'ADMIN'] as const satisfies readonly Section['minLevel'][];

// Sections without a screen yet load the placeholder; the real ones replace their `load`.
const placeholder = () => import('../sections/Placeholder.js');

/** Spec table 4.3. The order here is the order of the navigation. */
export const SECTIONS: readonly Section[] = [
  { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard, minLevel: 'SUPPORT', load: () => import('../sections/Overview.js') },
  { id: 'shift', labelKey: 'nav.shift', icon: Clock, minLevel: 'SUPPORT', load: placeholder },
  { id: 'tickets', labelKey: 'nav.tickets', icon: Ticket, minLevel: 'SUPPORT', load: placeholder },
  { id: 'stats', labelKey: 'nav.stats', icon: ChartColumn, minLevel: 'SUPPORT', load: placeholder },
  { id: 'shop', labelKey: 'nav.store', icon: ShoppingBag, minLevel: 'SUPPORT', load: placeholder },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings, minLevel: 'SUPPORT', load: () => import('../sections/Settings.js') },
  { id: 'staff', labelKey: 'nav.roster', icon: Users, minLevel: 'CURATOR', load: placeholder },
  { id: 'staffShifts', labelKey: 'nav.rosterShifts', icon: CalendarClock, minLevel: 'CURATOR', load: placeholder },
  {
    id: 'allTickets',
    labelKey: 'nav.allTickets',
    icon: Inbox,
    minLevel: 'CURATOR',
    permission: 'tickets.view_all',
    load: placeholder,
  },
  {
    id: 'reports',
    labelKey: 'nav.reports',
    icon: FileText,
    minLevel: 'CURATOR',
    permission: 'reports.view',
    load: placeholder,
  },
  { id: 'roles', labelKey: 'nav.roles', icon: ShieldCheck, minLevel: 'ADMIN', load: placeholder },
  {
    id: 'payroll',
    labelKey: 'nav.payroll',
    icon: Wallet,
    minLevel: 'ADMIN',
    permission: 'payroll.approve',
    load: placeholder,
  },
  { id: 'norms', labelKey: 'nav.quotas', icon: Gauge, minLevel: 'ADMIN', load: placeholder },
  {
    id: 'shopManage',
    labelKey: 'nav.storeAdmin',
    icon: Store,
    minLevel: 'ADMIN',
    permission: 'shop.manage',
    load: placeholder,
  },
  { id: 'audit', labelKey: 'nav.auditLog', icon: ScrollText, minLevel: 'ADMIN', load: placeholder },
];

/**
 * The sections a user sees. A convenience only: the backend enforces access.
 * `sections` can be replaced in tests.
 */
export function visibleSections(
  level: Level,
  permissions: readonly Permission[],
  sections: readonly Section[] = SECTIONS,
): Section[] {
  return sections.filter((section) => {
    if (RANK[level] < RANK[section.minLevel]) return false;
    if (!section.permission || RANK[level] >= RANK.ADMIN) return true;
    return permissions.includes(section.permission);
  });
}

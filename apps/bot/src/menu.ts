import { randomBytes } from 'node:crypto';
import type { ServerConfig } from '@crystalaid/config';
import type { Settings, SettingsPatch } from '@crystalaid/contracts';
import { PERMISSIONS, type Permission } from '@crystalaid/domain';
import { ApiError, type ApiClient } from './api.js';
import type { MenuResult, MenuRow, MenuView, ModalSpec } from './ports.js';
import { shortId } from './text.js';
import { addDays, localDate, localHour, parseTypedDate, showDate, stamp, zonedHour } from './zone.js';

// The menu keeps no authority. A custom id names a session and an action, nothing more; the person
// who acts is always the one in the interaction, and the API checks their level on every call.

export const STALE = 'Это меню устарело. Откройте /menu заново.';
export const STALE_DEV = 'Это меню устарело. Откройте /dev заново.';
const FAILED = 'Не удалось выполнить действие. Попробуйте ещё раз.';
const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 1000;
/** Discord messages hold 2000 characters; the schedule body leaves room for the header and notes. */
const PT_BODY_MAX = 1500;
const SELECT_MAX = 25;

export const PERMISSION_RU: Record<Permission, string> = {
  'tickets.view_all': 'Просмотр всех тикетов',
  'tickets.read_transcript': 'Чтение переписок',
  'tickets.transfer': 'Передача тикетов',
  'shifts.edit': 'Редактирование смен',
  'absences.approve': 'Одобрение отсутствий',
  'staff.warn': 'Предупреждения сотрудникам',
  'staff.note': 'Заметки о сотрудниках',
  'reports.view': 'Просмотр отчётов',
  'payroll.approve': 'Утверждение выплат',
  'tokens.grant': 'Начисление токенов',
  'tokens.deduct': 'Списание токенов',
  'shop.manage': 'Управление магазином',
};

const SETTING_FIELDS = [
  { key: 'ticketRate', label: 'Ставка за тикет', int: true },
  { key: 'shiftHourRate', label: 'Ставка за час смены', int: true },
  { key: 'normBonus', label: 'Бонус за выполнение нормы', int: true },
  { key: 'weeklyNormHours', label: 'Норма часов в неделю', int: false },
  { key: 'weeklyNormTickets', label: 'Норма тикетов в неделю', int: true },
] as const;

type MenuApi = Pick<
  ApiClient,
  | 'menuAccess'
  | 'ptList'
  | 'ptSet'
  | 'ptRemove'
  | 'settings'
  | 'patchSettings'
  | 'permissions'
  | 'patchPermissions'
  | 'openTickets'
  | 'deliveryFailures'
  | 'diagnostics'
>;

/** What the ticket buttons do. The handlers do the work and the messages; they give the note to show. */
export interface TicketOps {
  close(ticketId: string, actorId: string, actorName?: string): Promise<string>;
  release(ticketId: string, actorId: string, actorName?: string): Promise<string>;
}

export interface MenuDeps {
  api: MenuApi;
  tickets?: TicketOps;
  config: Pick<ServerConfig, 'timezone'>;
  now?: () => number;
  newSid?: () => string;
  botUptimeSeconds?: () => number;
  onError?: (err: unknown, where: string) => void;
}

interface Session {
  owner: string;
  kind: 'menu' | 'dev';
  seen: number;
  date: string;
  page: number;
  /** The person picked in the user select, waiting for an hour. */
  sel: string | null;
  /** The ticket picked in the open tickets list. */
  ticket: string | null;
  /** The settings last shown; the edit form opens from them, without asking the API (3 seconds). */
  settings: Settings | null;
}

const CID = /^m:([0-9a-f]{8}):([a-z-]+)$/;
const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODAL_ACTIONS = new Set(['pt-date', 'settings-edit']);

/** True when the component answers with a modal, which must be shown instead of deferring. */
export const opensModal = (customId: string): boolean => {
  const m = CID.exec(customId);
  return !!m && MODAL_ACTIONS.has(m[2]!);
};
export const isMenuId = (customId: string): boolean => CID.test(customId);

/** Escapes what Discord would render as markup or a mention in a name. */
const esc = (t: string, max = 40): string => t.slice(0, max).replace(/[\\*_`~|>@<[\]]/g, '\\$&');

function age(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} мин`;
  if (m < 1440) return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  return `${Math.floor(m / 1440)} д ${Math.floor((m % 1440) / 60)} ч`;
}

const denied = (reason: string): MenuView => ({ text: `Нет доступа.\nПричина: ${reason}.`, rows: [] });

const reasonOf = (err: ApiError): string =>
  err.code === 'NOT_STAFF' ? 'вы не состоите в ветке поддержки' : 'ваш уровень или права не позволяют это действие';

const isDenied = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.status === 403 || err.code === 'FORBIDDEN' || err.code === 'NOT_STAFF');

const cap = (text: string): string => (text.length > 2000 ? `${text.slice(0, 1997)}...` : text);

export function createMenu(deps: MenuDeps) {
  const { api, config } = deps;
  const tz = config.timezone;
  const now = deps.now ?? Date.now;
  const newSid = deps.newSid ?? (() => randomBytes(4).toString('hex'));
  const onError = deps.onError ?? ((err, where) => console.error(`[bot] ${where}:`, err));
  const sessions = new Map<string, Session>();

  const cid = (sid: string, action: string): string => `m:${sid}:${action}`;
  const back = (sid: string) => ({ id: cid(sid, 'home'), label: 'Назад', style: 'secondary' as const });

  function create(owner: string, kind: Session['kind']): string {
    for (const [k, s] of sessions) if (now() - s.seen > SESSION_TTL_MS) sessions.delete(k);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    const sid = newSid();
    sessions.set(sid, {
      owner,
      kind,
      seen: now(),
      date: localDate(new Date(now()), tz),
      page: 0,
      sel: null,
      ticket: null,
      settings: null,
    });
    return sid;
  }

  // ---------- views ----------

  function homeView(sid: string, a: { level: string; permissions: Permission[] }): MenuView {
    const admin = a.level === 'ADMIN' || a.level === 'DEVELOPER';
    const curator = admin || a.level === 'CURATOR';
    if (!curator) {
      return denied(a.level === 'SUPPORT' ? 'меню доступно кураторам и выше' : 'вы не состоите в ветке поддержки');
    }
    if (!admin && !a.permissions.includes('shifts.edit')) return denied('у вас нет права «Редактирование смен»');
    const buttons = [{ id: cid(sid, 'pt'), label: 'Расписание ПТ', style: 'primary' as const }];
    if (admin) {
      buttons.push(
        { id: cid(sid, 'settings'), label: 'Настройки', style: 'primary' },
        { id: cid(sid, 'permissions'), label: 'Права', style: 'primary' },
        { id: cid(sid, 'tickets'), label: 'Открытые тикеты', style: 'primary' },
        { id: cid(sid, 'delivery'), label: 'Ошибки доставки', style: 'primary' },
      );
    }
    return { text: '**Меню CrystalAid**\nВыберите раздел.', rows: [{ kind: 'buttons', buttons }] };
  }

  async function ptView(sid: string, s: Session, notice?: string): Promise<MenuView> {
    const { items } = await api.ptList(s.owner, s.date);
    const byHour: { name: string; id: string }[][] = Array.from({ length: 24 }, () => []);
    for (const it of items) byHour[localHour(it.startsAt, tz)]?.push({ name: it.username, id: it.discordId });

    const lines = byHour.map((people, h) => {
      const hh = `${String(h).padStart(2, '0')}:00`;
      let names = people.map((p) => esc(p.name)).join(', ') || '—';
      if (names.length > 160) names = `${names.slice(0, 157)}...`;
      return { h, text: `\`${hh}\` ${names}`, people };
    });
    // Pages by size, and by 25 slots so the "remove" select always fits all of them.
    const pages: (typeof lines)[] = [];
    let cur: typeof lines = [];
    let len = 0;
    let slots = 0;
    for (const l of lines) {
      if (cur.length && (len + l.text.length + 1 > PT_BODY_MAX || slots + l.people.length > SELECT_MAX)) {
        pages.push(cur);
        cur = [];
        len = 0;
        slots = 0;
      }
      cur.push(l);
      len += l.text.length + 1;
      slots += l.people.length;
    }
    pages.push(cur);
    s.page = Math.min(Math.max(s.page, 0), pages.length - 1);
    const pageLines = pages[s.page]!;

    const head = `**Расписание ПТ — ${showDate(s.date)}**${pages.length > 1 ? ` (стр. ${s.page + 1} из ${pages.length})` : ''}`;
    const parts = [notice ? notice.slice(0, 300) : null, head, pageLines.map((l) => l.text).join('\n')];
    parts.push(s.sel ? `Выбран: <@${s.sel}>. Теперь выберите час.` : 'Выберите сотрудника и час, чтобы назначить.');

    const rows: MenuRow[] = [
      {
        kind: 'buttons',
        buttons: [
          { id: cid(sid, 'pt-today'), label: 'Сегодня', style: 'secondary' },
          { id: cid(sid, 'pt-tomorrow'), label: 'Завтра', style: 'secondary' },
          { id: cid(sid, 'pt-date'), label: 'Другая дата', style: 'secondary' },
          back(sid),
        ],
      },
    ];
    if (pages.length > 1) {
      rows.push({
        kind: 'buttons',
        buttons: [
          { id: cid(sid, 'pt-prev'), label: '◀', style: 'secondary', disabled: s.page === 0 },
          { id: cid(sid, 'pt-next'), label: '▶', style: 'secondary', disabled: s.page === pages.length - 1 },
        ],
      });
    }
    rows.push({ kind: 'user', id: cid(sid, 'pt-user'), placeholder: 'Сотрудник для назначения' });
    rows.push({
      kind: 'select',
      id: cid(sid, 'pt-hour'),
      placeholder: 'Час: назначить выбранного',
      min: 1,
      max: 1,
      options: Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, value: String(h) })),
    });
    const removable = pageLines
      .flatMap((l) => l.people.map((p) => ({ h: l.h, ...p })))
      .slice(0, SELECT_MAX)
      .map((p) => ({ label: `${String(p.h).padStart(2, '0')}:00 — ${p.name}`.slice(0, 100), value: `${p.h}:${p.id}` }));
    if (removable.length) {
      rows.push({ kind: 'select', id: cid(sid, 'pt-rm'), placeholder: 'Снять сотрудника с часа', min: 1, max: 1, options: removable });
    }
    return { text: cap(parts.filter(Boolean).join('\n')), rows };
  }

  function settingsView(sid: string, st: Settings, notice?: string): MenuView {
    const body = SETTING_FIELDS.map((f) => `${f.label}: ${st[f.key]}`).join('\n');
    return {
      text: cap(`${notice ? `${notice}\n\n` : ''}**Настройки**\n${body}`),
      rows: [
        {
          kind: 'buttons',
          buttons: [{ id: cid(sid, 'settings-edit'), label: 'Изменить', style: 'primary' }, back(sid)],
        },
      ],
    };
  }

  function permissionsView(sid: string, grants: Record<'SUPPORT' | 'CURATOR', Permission[]>, notice?: string): MenuView {
    const select = (level: 'SUPPORT' | 'CURATOR'): MenuRow => ({
      kind: 'select',
      id: cid(sid, level === 'SUPPORT' ? 'perm-support' : 'perm-curator'),
      placeholder: level === 'SUPPORT' ? 'Права поддержки' : 'Права кураторов',
      min: 0,
      max: PERMISSIONS.length,
      options: PERMISSIONS.map((p) => ({ label: PERMISSION_RU[p], value: p, default: grants[level].includes(p) })),
    });
    const list = (l: Permission[]) => (l.length ? l.map((p) => PERMISSION_RU[p]).join(', ') : 'нет');
    return {
      text: cap(
        `${notice ? `${notice}\n\n` : ''}**Права**\nПоддержка: ${list(grants.SUPPORT)}\nКураторы: ${list(grants.CURATOR)}\n` +
          'Отметьте права в списке: выбранный набор заменяет прежний.',
      ),
      rows: [select('SUPPORT'), select('CURATOR'), { kind: 'buttons', buttons: [back(sid)] }],
    };
  }

  async function ticketsView(sid: string, s: Session, actor: string, notice?: string): Promise<MenuView> {
    const { items, total } = await api.openTickets(actor);
    const lines = items.map(
      (t) =>
        `#${shortId(t.ticketId)} — ${t.status === 'claimed' ? 'в работе' : 'ожидает'} — ${age(now() - Date.parse(t.createdAt))} — ` +
        (t.claimerUsername ? esc(t.claimerUsername, 32) : 'не взят'),
    );
    const more = total > items.length ? `\n…и ещё ${total - items.length}` : '';
    const picked = items.find((t) => t.ticketId === s.ticket);
    if (!picked) s.ticket = null;
    const parts = [
      notice ? notice.slice(0, 300) : null,
      `**Открытые тикеты** (${total})\n${lines.join('\n') || 'Открытых тикетов нет.'}${more}`,
      picked ? `Выбран: #${shortId(picked.ticketId)}.` : items.length ? 'Выберите тикет, чтобы закрыть его или вернуть в очередь.' : null,
    ];
    const rows: MenuRow[] = [];
    if (items.length) {
      rows.push({
        kind: 'select',
        id: cid(sid, 'ticket-pick'),
        placeholder: 'Тикет',
        min: 1,
        max: 1,
        options: items.map((t) => ({
          label: `#${shortId(t.ticketId)} — ${t.status === 'claimed' ? 'в работе' : 'ожидает'}`,
          value: t.ticketId,
          default: t.ticketId === picked?.ticketId,
        })),
      });
    }
    rows.push({
      kind: 'buttons',
      buttons: [
        { id: cid(sid, 'ticket-close'), label: 'Закрыть', style: 'danger', disabled: !picked },
        {
          id: cid(sid, 'ticket-release'),
          label: 'Вернуть в очередь',
          style: 'secondary',
          disabled: picked?.status !== 'claimed',
        },
        { id: cid(sid, 'tickets'), label: 'Обновить', style: 'secondary' },
        back(sid),
      ],
    });
    return { text: cap(parts.filter(Boolean).join('\n')), rows };
  }

  async function deliveryView(sid: string, actor: string): Promise<MenuView> {
    const { items } = await api.deliveryFailures(actor);
    const lines = items.map(
      (f) => `• ${stamp(f.at, tz)} — <@${f.discordId}> — ${esc(f.what, 60)}${f.code ? ` (код ${f.code})` : ''}`,
    );
    return {
      text: cap(`**Ошибки доставки** (последние ${items.length})\n${lines.join('\n') || 'Ошибок доставки нет.'}`),
      rows: [
        {
          kind: 'buttons',
          buttons: [{ id: cid(sid, 'delivery'), label: 'Обновить', style: 'secondary' }, back(sid)],
        },
      ],
    };
  }

  async function devView(sid: string, actor: string): Promise<MenuView> {
    const d = await api.diagnostics(actor);
    const ok = (v: boolean) => (v ? 'работает' : 'недоступна');
    const n = (v: number | null) => (v === null ? 'нет данных' : String(v));
    const errors = d.recentErrors.length
      ? d.recentErrors.map((e) => `• ${esc(e.id, 24)} — ${esc(e.error.replace(/\s+/g, ' '), 120)}`).join('\n')
      : 'нет';
    const text =
      `**Меню разработчика**\nВерсия: ${esc(d.version, 30)}, коммит: ${d.commit ? esc(d.commit, 20) : 'недоступен'}\n` +
      `Аптайм API: ${age(d.uptimeSeconds * 1000)}` +
      (deps.botUptimeSeconds ? `, бота: ${age(deps.botUptimeSeconds() * 1000)}` : '') +
      `\nБаза данных: ${ok(d.database)}\nRedis: ${ok(d.redis)}\n` +
      `events:bot: ${n(d.queueSize)}\nevents:dead: ${n(d.deadSize)}\nОткрытых тикетов: ${d.openTickets}\n` +
      `Последние ошибки доставки:\n${errors}`;
    return {
      text: cap(text),
      rows: [{ kind: 'buttons', buttons: [{ id: cid(sid, 'dev-refresh'), label: 'Обновить', style: 'primary' }] }],
    };
  }

  // ---------- entry points ----------

  async function guarded(fn: () => Promise<MenuResult>, sid?: string, where = 'menu'): Promise<MenuResult> {
    try {
      return await fn();
    } catch (err) {
      if (isDenied(err)) {
        if (sid) sessions.delete(sid);
        return { view: denied(reasonOf(err)) };
      }
      onError(err, where);
      return { note: FAILED };
    }
  }

  /** `/menu`. */
  function open(ix: { userId: string }): Promise<MenuResult> {
    return guarded(async () => {
      const a = await api.menuAccess(ix.userId);
      if (!homeView('', a).rows.length) return { view: homeView('', a) };
      return { view: homeView(create(ix.userId, 'menu'), a) };
    });
  }

  /** `/dev`. The API decides; a non-developer is refused there. */
  function openDev(ix: { userId: string }): Promise<MenuResult> {
    return guarded(
      async () => {
        const sid = create(ix.userId, 'dev');
        try {
          return { view: await devView(sid, ix.userId) };
        } catch (err) {
          sessions.delete(sid);
          throw err;
        }
      },
      undefined,
      'dev',
    );
  }

  /** Every button, select and modal submit of a menu message. */
  async function interact(ix: {
    userId: string;
    username?: string;
    customId: string;
    values?: string[];
    fields?: Record<string, string>;
  }): Promise<MenuResult> {
    const m = CID.exec(ix.customId);
    const sid = m?.[1];
    const action = m?.[2];
    const s = sid ? sessions.get(sid) : undefined;
    if (!sid || !action || !s || s.owner !== ix.userId || now() - s.seen > SESSION_TTL_MS) {
      if (sid && s && s.owner === ix.userId) sessions.delete(sid);
      return { note: s?.kind === 'dev' ? STALE_DEV : STALE };
    }
    s.seen = now();
    const actor = ix.userId;
    const v = ix.values ?? [];

    if (s.kind === 'dev') {
      if (action !== 'dev-refresh') return { note: STALE_DEV };
      return guarded(async () => ({ view: await devView(sid, actor) }), sid, 'dev');
    }
    return guarded(async () => {
      switch (action) {
        case 'home':
          return { view: homeView(sid, await api.menuAccess(actor)) };
        case 'pt':
        case 'pt-today':
          s.date = localDate(new Date(now()), tz);
          s.page = 0;
          return { view: await ptView(sid, s) };
        case 'pt-tomorrow':
          s.date = addDays(localDate(new Date(now()), tz), 1);
          s.page = 0;
          return { view: await ptView(sid, s) };
        case 'pt-date':
          return { modal: dateModal(sid, s) };
        case 'pt-date-modal': {
          const text = ix.fields?.date ?? '';
          const date = parseTypedDate(text, localDate(new Date(now()), tz));
          if (!date) {
            return { view: await ptView(sid, s, `Не удалось разобрать дату «${esc(text, 20)}». Формат: ДД.ММ.ГГГГ или ДД.ММ.`) };
          }
          s.date = date;
          s.page = 0;
          return { view: await ptView(sid, s) };
        }
        case 'pt-prev':
        case 'pt-next':
          s.page += action === 'pt-next' ? 1 : -1;
          return { view: await ptView(sid, s) };
        case 'pt-user': {
          const id = v[0] ?? '';
          if (!/^\d{17,20}$/.test(id)) return { note: FAILED };
          s.sel = id;
          return { view: await ptView(sid, s) };
        }
        case 'pt-hour': {
          const h = Number(v[0]);
          if (!Number.isInteger(h) || h < 0 || h > 23) return { note: FAILED };
          if (!s.sel) return { view: await ptView(sid, s, 'Сначала выберите сотрудника.') };
          const hh = String(h).padStart(2, '0');
          const startsAt = zonedHour(s.date, h, tz);
          if (!startsAt) return { view: await ptView(sid, s, `Часа ${hh}:00 в этот день нет: часы переводятся вперёд.`) };
          try {
            await api.ptSet(actor, startsAt.toISOString(), s.sel);
          } catch (err) {
            if (err instanceof ApiError && err.reason === 'not_staff') {
              return { view: await ptView(sid, s, 'Этот пользователь не состоит в ветке поддержки.') };
            }
            throw err;
          }
          return { view: await ptView(sid, s, `Назначено: <@${s.sel}> на ${hh}:00.`) };
        }
        case 'pt-rm': {
          const r = /^(\d{1,2}):(\d{17,20})$/.exec(v[0] ?? '');
          const h = r ? Number(r[1]) : -1;
          if (!r || h < 0 || h > 23) return { note: FAILED };
          let notice = `Снято: <@${r[2]}> с ${String(h).padStart(2, '0')}:00.`;
          const startsAt = zonedHour(s.date, h, tz);
          if (!startsAt) return { view: await ptView(sid, s, 'Этого часа в этот день нет.') };
          try {
            await api.ptRemove(actor, startsAt.toISOString(), r[2]!);
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) notice = 'Этот сотрудник уже снят с часа.';
            else throw err;
          }
          return { view: await ptView(sid, s, notice) };
        }
        case 'settings':
          s.settings = await api.settings(actor);
          return { view: settingsView(sid, s.settings) };
        case 'settings-edit':
          // Discord gives 3 seconds to open a modal: it shows what the settings view showed, with no API call.
          return s.settings ? { modal: settingsModal(sid, s.settings) } : { note: STALE };
        case 'settings-modal':
          return settingsSubmit(sid, s, actor, ix.fields ?? {});
        case 'permissions':
          return { view: permissionsView(sid, await api.permissions(actor)) };
        case 'perm-support':
        case 'perm-curator': {
          const grants = v.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
          const level = action === 'perm-support' ? 'SUPPORT' : 'CURATOR';
          return { view: permissionsView(sid, await api.patchPermissions(actor, level, grants), 'Права сохранены.') };
        }
        case 'tickets':
          return { view: await ticketsView(sid, s, actor) };
        case 'ticket-pick': {
          const t = v[0] ?? '';
          if (!TICKET_ID.test(t)) return { note: FAILED };
          s.ticket = t;
          return { view: await ticketsView(sid, s, actor) };
        }
        case 'ticket-close':
        case 'ticket-release': {
          const t = s.ticket;
          if (!t) return { view: await ticketsView(sid, s, actor, 'Сначала выберите тикет.') };
          if (!deps.tickets) return { note: FAILED };
          s.ticket = null;
          const note =
            action === 'ticket-close'
              ? await deps.tickets.close(t, actor, ix.username)
              : await deps.tickets.release(t, actor, ix.username);
          return { view: await ticketsView(sid, s, actor, note) };
        }
        case 'delivery':
          return { view: await deliveryView(sid, actor) };
        default:
          return { note: STALE };
      }
    }, sid);
  }

  function dateModal(sid: string, s: Session): ModalSpec {
    return {
      id: cid(sid, 'pt-date-modal'),
      title: 'Дата расписания',
      inputs: [{ id: 'date', label: 'Дата (ДД.ММ.ГГГГ или ДД.ММ)', value: showDate(s.date), required: true, maxLength: 10 }],
    };
  }

  function settingsModal(sid: string, st: Settings): ModalSpec {
    return {
      id: cid(sid, 'settings-modal'),
      title: 'Ставки и нормы',
      inputs: SETTING_FIELDS.map((f) => ({
        id: f.key,
        label: f.label,
        value: String(st[f.key]),
        required: true,
        maxLength: 9,
      })),
    };
  }

  async function settingsSubmit(
    sid: string,
    s: Session,
    actor: string,
    fields: Record<string, string>,
  ): Promise<MenuResult> {
    const patch: Record<string, number> = {};
    const problems: string[] = [];
    for (const f of SETTING_FIELDS) {
      const raw = (fields[f.key] ?? '').trim().replace(',', '.');
      const okShape = f.int ? /^\d+$/.test(raw) : /^\d+(\.\d+)?$/.test(raw);
      if (!okShape) {
        problems.push(`• ${f.label}: ${f.int ? 'нужно целое число, не меньше 0' : 'нужно число, не меньше 0'}`);
      } else {
        patch[f.key] = Number(raw);
      }
    }
    // The current values are shown again whatever happens; the API also rejects bad values.
    if (problems.length) {
      s.settings = await api.settings(actor);
      return { view: settingsView(sid, s.settings, `Не сохранено:\n${problems.join('\n')}`) };
    }
    try {
      s.settings = await api.patchSettings(actor, patch as SettingsPatch);
      return { view: settingsView(sid, s.settings, 'Настройки сохранены.') };
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        s.settings = await api.settings(actor);
        return { view: settingsView(sid, s.settings, `Не сохранено: ${err.message.slice(0, 200)}`) };
      }
      throw err;
    }
  }

  return { open, openDev, interact };
}

export type Menu = ReturnType<typeof createMenu>;

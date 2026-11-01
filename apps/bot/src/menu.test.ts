import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@crystalaid/domain';
import { STALE, STALE_DEV, createMenu, type Menu } from './menu.js';
import type { MenuResult, MenuView } from './ports.js';
import { ApiStub, CFG, TICKET, apiError, id } from './testing/kit.js';
import { addDays, localDate, parseTypedDate, zonedHour } from './zone.js';
import { ApiError } from './api.js';

const DEV = id(21);
const ADMIN = id(20);
const CURATOR = id(30);
const CURATOR_NO_SHIFTS = id(31);
const SUPPORT = id(32);
const NOBODY = id(33);
const STAFF_A = id(40);
const STAFF_B = id(41);

// 2026-11-01 12:00 in Moscow (UTC+3).
const NOW = Date.parse('2026-11-01T09:00:00Z');
const level = (l: string, permissions: string[] = []) => ({ json: { level: l, permissions } });

let api: ApiStub;
let menu: Menu;
let clock: number;
let errors: unknown[];

beforeEach(async () => {
  api = new ApiStub();
  await api.start();
  clock = NOW;
  errors = [];
  let n = 0;
  menu = createMenu({
    api: api.client(),
    config: CFG,
    now: () => clock,
    newSid: () => (++n).toString(16).padStart(8, '0'),
    botUptimeSeconds: () => 90,
    onError: (e) => errors.push(e),
  });
  const levels: Record<string, ReturnType<typeof level>> = {
    [DEV]: level('DEVELOPER', [...PERMISSIONS]),
    [ADMIN]: level('ADMIN', [...PERMISSIONS]),
    [CURATOR]: level('CURATOR', ['shifts.edit']),
    [CURATOR_NO_SHIFTS]: level('CURATOR', ['reports.view']),
    [SUPPORT]: level('SUPPORT'),
    [NOBODY]: level('NONE'),
  };
  api.on('GET /internal/menu/access', (_b, q) => levels[q.get('actorDiscordId') ?? ''] ?? level('NONE'));
});
afterEach(() => api.stop());

const view = (r: MenuResult): MenuView => {
  if (!('view' in r)) throw new Error(`expected a view, got ${JSON.stringify(r)}`);
  return r.view;
};
const buttonIds = (v: MenuView) => v.rows.flatMap((r) => (r.kind === 'buttons' ? r.buttons.map((b) => b.id) : [r.id]));
const labels = (v: MenuView) => v.rows.flatMap((r) => (r.kind === 'buttons' ? r.buttons.map((b) => b.label) : []));
const sidOf = (v: MenuView) => /^m:([0-9a-f]{8}):/.exec(buttonIds(v)[0]!)![1]!;
const cid = (sid: string, action: string) => `m:${sid}:${action}`;

async function opened(user: string) {
  const v = view(await menu.open({ userId: user }));
  return { v, sid: sidOf(v) };
}
const ptList = (items: { startsAt: string; discordId: string; username: string }[] = []) => ({ json: { items } });
const slot = (hourUtc: number, discordId: string, username: string, date = '2026-11-01') => ({
  startsAt: `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`,
  discordId,
  username,
});

function limitsHold(v: MenuView) {
  expect(v.text.length).toBeLessThanOrEqual(2000);
  expect(v.rows.length).toBeLessThanOrEqual(5);
  for (const r of v.rows) {
    if (r.kind === 'select') expect(r.options.length).toBeLessThanOrEqual(25);
    if (r.kind === 'buttons') expect(r.buttons.length).toBeLessThanOrEqual(5);
    const ids = r.kind === 'buttons' ? r.buttons.map((b) => b.id) : [r.id];
    for (const i of ids) expect(i.length).toBeLessThanOrEqual(100);
  }
}

describe('/menu access by level', () => {
  it('gives an admin and a developer every section', async () => {
    for (const who of [ADMIN, DEV]) {
      const { v } = await opened(who);
      expect(labels(v)).toEqual(['Расписание ПТ', 'Настройки', 'Права', 'Открытые тикеты', 'Ошибки доставки']);
    }
  });

  it('gives a curator with shifts.edit only the schedule', async () => {
    expect(labels((await opened(CURATOR)).v)).toEqual(['Расписание ПТ']);
  });

  it('refuses everyone else and says why', async () => {
    const cases: [string, string][] = [
      [CURATOR_NO_SHIFTS, 'Редактирование смен'],
      [SUPPORT, 'кураторам и выше'],
      [NOBODY, 'не состоите в ветке'],
    ];
    for (const [who, why] of cases) {
      const v = view(await menu.open({ userId: who }));
      expect(v.text).toContain('Нет доступа');
      expect(v.text).toContain(why);
      expect(v.rows).toEqual([]);
    }
  });
});

describe('schedule', () => {
  beforeEach(() => {
    api.on('GET /internal/pt', () => ptList([slot(11, STAFF_A, 'anna'), slot(11, STAFF_B, 'boris'), slot(15, STAFF_A, 'anna')]));
  });

  it('shows 24 hours in the configured timezone and acts as the person who clicked', async () => {
    const { sid } = await opened(CURATOR);
    const v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') }));
    expect(api.called('GET /internal/pt')[0]!.query).toEqual({ actorDiscordId: CURATOR, date: '2026-11-01' });
    expect(v.text).toContain('01.11.2026');
    expect(v.text).toContain('`14:00` anna, boris');
    expect(v.text).toContain('`00:00` —');
    expect(v.text).toContain('`23:00`');
    expect(v.text).toContain('`00:00` —\n');
    limitsHold(v);
    const hours = v.rows.find((r) => r.kind === 'select' && r.id.endsWith(':pt-hour'));
    expect(hours?.kind === 'select' && hours.options).toHaveLength(24);
  });

  it('picks tomorrow and a typed date', async () => {
    const { sid } = await opened(CURATOR);
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-tomorrow') });
    expect(api.called('GET /internal/pt').at(-1)!.query.date).toBe('2026-11-02');
    const modal = await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-date') });
    expect('modal' in modal && modal.modal.id).toBe(cid(sid, 'pt-date-modal'));
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-date-modal'), fields: { date: '05.11.2026' } });
    expect(api.called('GET /internal/pt').at(-1)!.query.date).toBe('2026-11-05');
  });

  it('keeps the page and explains an invalid typed date', async () => {
    const { sid } = await opened(CURATOR);
    for (const bad of ['вчера', '31.02.2026', '2026-13-01', '']) {
      const v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-date-modal'), fields: { date: bad } }));
      expect(v.text).toContain('Не удалось разобрать дату');
      expect(v.text).toContain('Расписание ПТ');
    }
    expect(api.called('GET /internal/pt').every((c) => c.query.date === '2026-11-01')).toBe(true);
  });

  it('assigns through a user select and an hour select', async () => {
    api.on('PUT /internal/pt', () => ({ json: { created: true } }));
    const { sid } = await opened(CURATOR);
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') });
    const picked = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-user'), values: [STAFF_B] }));
    expect(picked.text).toContain(`<@${STAFF_B}>`);
    const done = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-hour'), values: ['14'] }));
    expect(api.called('PUT /internal/pt')[0]!.body).toEqual({
      actorDiscordId: CURATOR,
      startsAt: '2026-11-01T11:00:00.000Z',
      discordUserId: STAFF_B,
    });
    expect(done.text).toContain('Назначено');
  });

  it('asks for a person first and tells when the person is not staff', async () => {
    api.on('PUT /internal/pt', () => apiError(400, 'VALIDATION_ERROR', 'not_staff'));
    const { sid } = await opened(CURATOR);
    const first = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-hour'), values: ['9'] }));
    expect(first.text).toContain('Сначала выберите сотрудника');
    expect(api.called('PUT /internal/pt')).toHaveLength(0);
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-user'), values: [NOBODY] });
    const v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-hour'), values: ['9'] }));
    expect(v.text).toContain('не состоит в ветке поддержки');
  });

  it('removes a person from an hour, and says so when already removed', async () => {
    api.on('DELETE /internal/pt', () => ({ json: { ok: true } }));
    const { sid } = await opened(CURATOR);
    const v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') }));
    const rm = v.rows.find((r) => r.kind === 'select' && r.id.endsWith(':pt-rm'));
    expect(rm?.kind === 'select' && rm.options.map((o) => o.value)).toEqual([`14:${STAFF_A}`, `14:${STAFF_B}`, `18:${STAFF_A}`]);
    const out = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-rm'), values: [`14:${STAFF_B}`] }));
    const del = api.called('DELETE /internal/pt')[0]!;
    expect(del.query).toEqual({
      actorDiscordId: CURATOR,
      startsAt: '2026-11-01T11:00:00.000Z',
      discordUserId: STAFF_B,
    });
    expect(out.text).toContain('Снято');

    api.on('DELETE /internal/pt', () => apiError(404, 'NOT_FOUND'));
    const again = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-rm'), values: [`14:${STAFF_B}`] }));
    expect(again.text).toContain('уже снят');
  });

  it('splits a crowded day into pages that respect Discord limits', async () => {
    const crowd = Array.from({ length: 24 }, (_, h) =>
      Array.from({ length: 4 }, (_, k) => slot((h + 21) % 24, id(100 + h * 4 + k), `very_long_staff_name_${h}_${k}_xxxxxxxx`)),
    ).flat();
    api.on('GET /internal/pt', () => ptList(crowd));
    const { sid } = await opened(CURATOR);
    let v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') }));
    expect(v.text).toMatch(/стр\. 1 из \d+/);
    limitsHold(v);
    const seen = new Set<string>();
    for (let i = 0; i < 12 && !v.text.includes('23:00'); i++) {
      for (const m of v.text.matchAll(/`(\d\d):00`/g)) seen.add(m[1]!);
      v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-next') }));
      limitsHold(v);
    }
    for (const m of v.text.matchAll(/`(\d\d):00`/g)) seen.add(m[1]!);
    expect(seen.size).toBe(24);
  });

  it('shows a curator who lost the role between opening and acting a refusal', async () => {
    api.on('PUT /internal/pt', () => apiError(403, 'FORBIDDEN'));
    const { sid } = await opened(CURATOR);
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-user'), values: [STAFF_A] });
    const v = view(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-hour'), values: ['10'] }));
    expect(v.text).toContain('Нет доступа');
    expect(v.rows).toEqual([]);
    const after = await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') });
    expect(after).toEqual({ note: STALE });
  });

  it('shows "Нет доступа" when the level is gone and a menu is reopened from Назад', async () => {
    const { sid } = await opened(ADMIN);
    api.on('GET /internal/menu/access', () => level('SUPPORT'));
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'home') }));
    expect(v.text).toContain('Нет доступа');
  });
});

describe('admin sections', () => {
  const SETTINGS = {
    ticketRate: 10,
    shiftHourRate: 5,
    normBonus: 50,
    weeklyNormHours: 20,
    weeklyNormTickets: 30,
    ticketWaitMinutes: 30,
    inactivityMinutes: 30,
    inactivityReplyMinutes: 10,
    warningDays: 30,
    ticketCategories: [],
  };
  const fields = (o: Record<string, string> = {}) => ({
    ticketRate: '12',
    shiftHourRate: '6',
    normBonus: '70',
    weeklyNormHours: '7,5',
    weeklyNormTickets: '25',
    ...o,
  });

  it('prefills the settings modal and saves valid values', async () => {
    api.on('GET /internal/menu/settings', () => ({ json: SETTINGS }));
    api.on('PATCH /internal/menu/settings', (b) => ({ json: { ...SETTINGS, ...(b as { patch: object }).patch } }));
    const { sid } = await opened(ADMIN);
    await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings') });
    const modal = await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings-edit') });
    // The modal shows what the settings view showed; it asks the API nothing (I3).
    expect(api.called('GET /internal/menu/settings')).toHaveLength(1);
    expect('modal' in modal && modal.modal.inputs.map((i) => [i.id, i.value])).toEqual([
      ['ticketRate', '10'],
      ['shiftHourRate', '5'],
      ['normBonus', '50'],
      ['weeklyNormHours', '20'],
      ['weeklyNormTickets', '30'],
    ]);
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings-modal'), fields: fields() }));
    expect(api.called('PATCH /internal/menu/settings')[0]!.body).toEqual({
      actorDiscordId: ADMIN,
      patch: { ticketRate: 12, shiftHourRate: 6, normBonus: 70, weeklyNormHours: 7.5, weeklyNormTickets: 25 },
    });
    expect(v.text).toContain('Настройки сохранены');
    expect(v.text).toContain('Ставка за тикет: 12');
  });

  it('shows validation errors and does not call the API with bad values', async () => {
    api.on('GET /internal/menu/settings', () => ({ json: SETTINGS }));
    const { sid } = await opened(ADMIN);
    const v = view(
      await menu.interact({
        userId: ADMIN,
        customId: cid(sid, 'settings-modal'),
        fields: fields({ ticketRate: 'много', normBonus: '-5', weeklyNormTickets: '2.5' }),
      }),
    );
    expect(v.text).toContain('Не сохранено');
    expect(v.text).toContain('Ставка за тикет');
    expect(v.text).toContain('Бонус за выполнение нормы');
    expect(v.text).toContain('Норма тикетов в неделю');
    expect(v.text).not.toContain('Норма часов в неделю: нужно');
    expect(api.called('PATCH /internal/menu/settings')).toHaveLength(0);
  });

  it('shows the API validation message', async () => {
    api.on('GET /internal/menu/settings', () => ({ json: SETTINGS }));
    api.on('PATCH /internal/menu/settings', () => apiError(400, 'VALIDATION_ERROR'));
    const { sid } = await opened(ADMIN);
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings-modal'), fields: fields() }));
    expect(v.text).toContain('Не сохранено: x');
  });

  it('refuses settings to an admin who lost the role', async () => {
    api.on('GET /internal/menu/settings', () => apiError(403, 'FORBIDDEN'));
    const { sid } = await opened(ADMIN);
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings') }));
    expect(v.text).toContain('Нет доступа');
  });

  it('toggles permissions through a multi-select', async () => {
    const grants = { SUPPORT: [], CURATOR: ['shifts.edit'] };
    api.on('GET /internal/permissions', () => ({ json: grants }));
    api.on('PATCH /internal/permissions', (b) => {
      const body = b as { level: 'SUPPORT' | 'CURATOR'; grants: string[] };
      return { json: { ...grants, [body.level]: body.grants } };
    });
    const { sid } = await opened(ADMIN);
    const shown = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'permissions') }));
    const sel = shown.rows.find((r) => r.kind === 'select' && r.id.endsWith(':perm-curator'));
    expect(sel?.kind === 'select' && sel.options.filter((o) => o.default).map((o) => o.value)).toEqual(['shifts.edit']);
    limitsHold(shown);

    const v = view(
      await menu.interact({
        userId: ADMIN,
        customId: cid(sid, 'perm-support'),
        values: ['tickets.view_all', 'bogus.permission'],
      }),
    );
    expect(api.called('PATCH /internal/permissions')[0]!.body).toEqual({
      actorDiscordId: ADMIN,
      level: 'SUPPORT',
      grants: ['tickets.view_all'],
    });
    expect(v.text).toContain('Права сохранены');
    expect(v.text).toContain('Поддержка: Просмотр всех тикетов');
  });

  it('lists open tickets with status, age and claimer', async () => {
    api.on('GET /internal/tickets/open', () => ({
      json: {
        total: 3,
        items: [
          { ticketId: TICKET, status: 'claimed', createdAt: '2026-11-01T07:30:00Z', claimerDiscordId: STAFF_A, claimerUsername: 'anna_s' },
          { ticketId: TICKET.replace('1111', '9999'), status: 'open', createdAt: '2026-11-01T08:55:00Z', claimerDiscordId: null, claimerUsername: null },
        ],
      },
    }));
    const { sid } = await opened(ADMIN);
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'tickets') }));
    expect(v.text).toContain('#11111111 — в работе — 1 ч 30 мин — anna\\_s');
    expect(v.text).toContain('— ожидает — 5 мин — не взят');
    expect(v.text).toContain('и ещё 1');
  });
});

describe('/dev', () => {
  const DIAG = {
    version: '1.2.3',
    commit: 'abc1234',
    uptimeSeconds: 7500,
    queueSize: 4,
    deadSize: 2,
    openTickets: 6,
    database: true,
    redis: false,
    recentErrors: Array.from({ length: 5 }, (_, i) => ({ id: `170000000000${i}-0`, error: `boom ${i} ${'y'.repeat(300)}` })),
  };

  it('shows the state to a developer and refreshes it', async () => {
    let size = 4;
    api.on('GET /internal/diagnostics', () => ({ json: { ...DIAG, queueSize: size } }));
    const v = view(await menu.openDev({ userId: DEV }));
    expect(api.called('GET /internal/diagnostics')[0]!.query).toEqual({ actorDiscordId: DEV });
    for (const part of [
      '1.2.3',
      'abc1234',
      '2 ч 5 мин',
      'бота: 1 мин',
      'База данных: работает',
      'Redis: недоступна',
      'events:bot: 4',
      'events:dead: 2',
      'Открытых тикетов: 6',
      'boom 0',
    ]) {
      expect(v.text).toContain(part);
    }
    limitsHold(v);
    expect(labels(v)).toEqual(['Обновить']);
    size = 9;
    const again = view(await menu.interact({ userId: DEV, customId: buttonIds(v)[0]! }));
    expect(again.text).toContain('events:bot: 9');
  });

  it('works without a commit and without Redis numbers', async () => {
    api.on('GET /internal/diagnostics', () => ({ json: { ...DIAG, commit: null, queueSize: null, deadSize: null, recentErrors: [] } }));
    const v = view(await menu.openDev({ userId: DEV }));
    expect(v.text).toContain('коммит: недоступен');
    expect(v.text).toContain('events:bot: нет данных');
  });

  it('says "Нет доступа" to everyone below a developer', async () => {
    api.on('GET /internal/diagnostics', (_b, q) =>
      q.get('actorDiscordId') === NOBODY ? apiError(403, 'NOT_STAFF', 'not_in_branch') : apiError(403, 'FORBIDDEN'),
    );
    for (const who of [ADMIN, CURATOR, SUPPORT]) {
      const v = view(await menu.openDev({ userId: who }));
      expect(v.text).toContain('Нет доступа');
      expect(v.rows).toEqual([]);
    }
    expect(view(await menu.openDev({ userId: NOBODY })).text).toContain('не состоите в ветке');
  });

  it('refuses a refresh after the developer lost the role', async () => {
    api.on('GET /internal/diagnostics', () => ({ json: DIAG }));
    const v = view(await menu.openDev({ userId: DEV }));
    api.on('GET /internal/diagnostics', () => apiError(403, 'FORBIDDEN'));
    const after = view(await menu.interact({ userId: DEV, customId: buttonIds(v)[0]! }));
    expect(after.text).toContain('Нет доступа');
  });
});

describe('stale and foreign interactions', () => {
  it('fail with a short message', async () => {
    api.on('GET /internal/pt', () => ptList());
    const { sid } = await opened(CURATOR);
    // Unknown session (for example after a restart).
    expect(await menu.interact({ userId: CURATOR, customId: cid('deadbeef', 'pt') })).toEqual({ note: STALE });
    // Somebody else pressing the button.
    expect(await menu.interact({ userId: ADMIN, customId: cid(sid, 'pt') })).toEqual({ note: STALE });
    // Not a menu id at all.
    expect(await menu.interact({ userId: CURATOR, customId: 'claim:x' })).toEqual({ note: STALE });
    // Idle for too long.
    clock += 16 * 60_000;
    expect(await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') })).toEqual({ note: STALE });
    expect(api.called('GET /internal/pt')).toHaveLength(0);
  });

  it('keeps /dev and /menu sessions apart', async () => {
    api.on('GET /internal/diagnostics', () => ({
      json: { version: '1', commit: null, uptimeSeconds: 1, queueSize: 0, deadSize: 0, openTickets: 0, database: true, redis: true, recentErrors: [] },
    }));
    const dev = view(await menu.openDev({ userId: DEV }));
    const sid = sidOf(dev);
    expect(await menu.interact({ userId: DEV, customId: cid(sid, 'settings') })).toEqual({ note: STALE_DEV });
    expect(api.called('GET /internal/menu/settings')).toHaveLength(0);
  });

  it('never takes the acting person from a custom id', async () => {
    api.on('PUT /internal/pt', () => ({ json: { created: true } }));
    api.on('GET /internal/pt', () => ptList());
    const { sid } = await opened(CURATOR);
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-user'), values: [STAFF_A] });
    // A forged id that names somebody else is not a menu id and changes nothing.
    expect(await menu.interact({ userId: CURATOR, customId: `m:${sid}:pt-hour:${ADMIN}`, values: ['3'] })).toEqual({ note: STALE });
    await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt-hour'), values: ['3'] });
    expect((api.called('PUT /internal/pt')[0]!.body as { actorDiscordId: string }).actorDiscordId).toBe(CURATOR);
    expect(api.calls.every((c) => c.auth === 'Bearer service-token')).toBe(true);
  });

  it('reports other failures briefly and logs them', async () => {
    api.on('GET /internal/pt', () => ({ status: 500, json: { error: { code: 'INTERNAL', message: 'x' } } }));
    const { sid } = await opened(CURATOR);
    const r = await menu.interact({ userId: CURATOR, customId: cid(sid, 'pt') });
    expect('note' in r && r.note.length).toBeLessThan(80);
    expect(errors).toHaveLength(1);
  });
});

describe('dates and hours', () => {
  it('reads typed dates', () => {
    expect(parseTypedDate('5.11', '2026-11-01')).toBe('2026-11-05');
    expect(parseTypedDate('05.11.2027', '2026-11-01')).toBe('2027-11-05');
    expect(parseTypedDate('2026-11-05', '2026-11-01')).toBe('2026-11-05');
    expect(parseTypedDate('29.02.2026', '2026-11-01')).toBeNull();
    expect(parseTypedDate('завтра', '2026-11-01')).toBeNull();
  });
  it('maps a local hour to its instant', () => {
    expect(zonedHour('2026-11-01', 0, 'Europe/Moscow')!.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(localDate(new Date('2026-10-31T21:30:00Z'), 'Europe/Moscow')).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('settings modal without an API call (I3)', () => {
  it('opens from the session and refuses a session that never showed the settings', async () => {
    const { sid } = await opened(ADMIN);
    expect(await menu.interact({ userId: ADMIN, customId: cid(sid, 'settings-edit') })).toEqual({ note: STALE });
    expect(api.called('GET /internal/menu/settings')).toHaveLength(0);
  });
});

describe('open tickets: close and release (C3)', () => {
  const T2 = TICKET.replace('1111', '9999');
  const list = {
    total: 2,
    items: [
      { ticketId: TICKET, status: 'claimed', createdAt: '2026-11-01T07:30:00Z', claimerDiscordId: STAFF_A, claimerUsername: 'anna' },
      { ticketId: T2, status: 'open', createdAt: '2026-11-01T08:55:00Z', claimerDiscordId: null, claimerUsername: null },
    ],
  };
  let acts: string[];
  let refuse: boolean;
  let m: Menu;
  const buttonsOf = (v: MenuView) =>
    v.rows.flatMap((r) => (r.kind === 'buttons' ? r.buttons : [])).map((b) => `${b.label}${b.disabled ? ':off' : ''}`);

  beforeEach(() => {
    acts = [];
    refuse = false;
    api.on('GET /internal/tickets/open', () => ({ json: list }));
    let n = 0;
    m = createMenu({
      api: api.client(),
      config: CFG,
      now: () => clock,
      newSid: () => (++n + 100).toString(16).padStart(8, '0'),
      onError: (e) => errors.push(e),
      tickets: {
        close: async (t, actor, name) => {
          if (refuse) throw new ApiError(403, 'FORBIDDEN', undefined, 'x');
          acts.push(`close ${t} ${actor} ${name}`);
          return 'Тикет #11111111 закрыт.';
        },
        release: async (t, actor) => (acts.push(`release ${t} ${actor}`), 'Тикет #11111111 возвращён в очередь.'),
      },
    });
  });

  async function opened2() {
    const home = view(await m.open({ userId: ADMIN }));
    const sid = sidOf(home);
    return { sid, v: view(await m.interact({ userId: ADMIN, customId: cid(sid, 'tickets') })) };
  }

  it('offers a select of tickets, with Close and Release off until one is picked', async () => {
    const { v } = await opened2();
    const sel = v.rows.find((r) => r.kind === 'select');
    expect(sel?.kind === 'select' && sel.options.map((o) => o.value)).toEqual([TICKET, T2]);
    expect(buttonsOf(v)).toEqual(['Закрыть:off', 'Вернуть в очередь:off', 'Обновить', 'Назад']);
    limitsHold(v);
  });

  it('closes the picked ticket as the person who pressed, then shows the refreshed list', async () => {
    const { sid } = await opened2();
    const picked = view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-pick'), values: [TICKET] }));
    expect(picked.text).toContain('Выбран: #11111111');
    expect(buttonsOf(picked)).toEqual(['Закрыть', 'Вернуть в очередь', 'Обновить', 'Назад']);
    const after = view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-close'), username: 'boss' }));
    expect(acts).toEqual([`close ${TICKET} ${ADMIN} boss`]);
    expect(after.text).toContain('Тикет #11111111 закрыт.');
    expect(buttonsOf(after)).toEqual(['Закрыть:off', 'Вернуть в очередь:off', 'Обновить', 'Назад']);
  });

  it('releases only a claimed ticket', async () => {
    const { sid } = await opened2();
    const open = view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-pick'), values: [T2] }));
    expect(buttonsOf(open)).toEqual(['Закрыть', 'Вернуть в очередь:off', 'Обновить', 'Назад']);
    await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-pick'), values: [TICKET] });
    const done = view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-release') }));
    expect(acts).toEqual([`release ${TICKET} ${ADMIN}`]);
    expect(done.text).toContain('возвращён в очередь');
  });

  it('asks to pick first, and ignores a value that is not a ticket id', async () => {
    const { sid } = await opened2();
    expect(view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-close') })).text).toContain('Сначала выберите тикет');
    expect(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-pick'), values: ['nope'] })).toEqual({ note: expect.any(String) });
    expect(acts).toEqual([]);
  });

  it('shows "Нет доступа" when the admin lost the role in between', async () => {
    const { sid } = await opened2();
    await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-pick'), values: [TICKET] });
    refuse = true;
    const r = view(await m.interact({ userId: ADMIN, customId: cid(sid, 'ticket-close') }));
    expect(r.text).toContain('Нет доступа');
    expect(r.rows).toEqual([]);
  });
});
describe('delivery failures (I9)', () => {
  it('lists the last failed DMs for an admin', async () => {
    api.on('GET /internal/delivery-failures', () => ({
      json: {
        items: [
          { at: '2026-11-01T08:55:00Z', discordId: STAFF_A, what: 'напоминание о ПТ', code: 50007 },
          { at: '2026-11-01T07:00:00Z', discordId: STAFF_B, what: 'тикет #11111111', code: null },
        ],
      },
    }));
    const { sid } = await opened(ADMIN);
    const v = view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'delivery') }));
    expect(api.called('GET /internal/delivery-failures')[0]!.query).toEqual({ actorDiscordId: ADMIN });
    expect(v.text).toContain('Ошибки доставки');
    expect(v.text).toContain('01.11 11:55');
    expect(v.text).toContain(`<@${STAFF_A}>`);
    expect(v.text).toContain('напоминание о ПТ');
    expect(v.text).toContain('50007');
    limitsHold(v);
  });

  it('says so when there are none, and shows "Нет доступа" when the admin lost the role', async () => {
    api.on('GET /internal/delivery-failures', () => ({ json: { items: [] } }));
    const { sid } = await opened(ADMIN);
    expect(view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'delivery') })).text).toContain('Ошибок доставки нет');
    api.on('GET /internal/delivery-failures', () => apiError(403, 'FORBIDDEN'));
    expect(view(await menu.interact({ userId: ADMIN, customId: cid(sid, 'delivery') })).text).toContain('Нет доступа');
  });
});

describe('hours that do not exist (zone)', () => {
  it('rejects a spring-forward gap, takes the first of a repeated hour, and keeps Moscow right', () => {
    expect(zonedHour('2026-03-29', 2, 'Europe/Berlin')).toBeNull();
    expect(zonedHour('2026-03-29', 3, 'Europe/Berlin')!.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(zonedHour('2026-10-25', 2, 'Europe/Berlin')!.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(zonedHour('2026-07-01', 12, 'Europe/Berlin')!.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(zonedHour('2026-11-01', 0, 'Europe/Moscow')!.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(zonedHour('2026-11-01', 23, 'Europe/Moscow')!.toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });
});
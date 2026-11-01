import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers.js';
import { createScheduler } from './scheduler.js';
import { ApiStub, CFG, FakeDiscord, MemoryStore, TICKET, apiError, challenge, id } from './testing/kit.js';

let api: ApiStub;
let discord: FakeDiscord;
let store: MemoryStore;
let errors: unknown[];
let clock: number;
const SLOT = '33333333-2222-4333-8444-555555555555';
const SLOT2 = '44444444-2222-4333-8444-555555555555';
const START = Date.parse('2026-11-02T11:00:00.000Z');

function make() {
  const handlers = createHandlers({
    api: api.client(),
    discord,
    store,
    config: CFG,
    onError: (e) => errors.push(e),
    sleep: async () => {},
  });
  return createScheduler({
    api: api.client(),
    handlers,
    config: CFG,
    now: () => clock,
    onError: (e) => errors.push(e),
  });
}

beforeEach(async () => {
  api = new ApiStub();
  await api.start();
  discord = new FakeDiscord();
  store = new MemoryStore();
  errors = [];
  clock = 1_000_000;
  api.on('POST /internal/tickets/expire', () => ({ json: { items: [] } }));
  api.on('POST /internal/pt/reminders/confirm', () => ({ json: { ok: true } }));
  api.on('POST /internal/delivery-failures', () => ({ json: { ok: true } }));
});
afterEach(() => api.stop());

describe('scheduler', () => {
  it('sends the PT reminder in the configured timezone and offers due tickets', async () => {
    api.on('GET /internal/pt/reminders', () => ({
      json: { items: [{ slotId: SLOT, startsAt: '2026-11-02T11:00:00.000Z', discordId: id(60), username: 's' }] },
    }));
    clock = START - 5 * 60_000;
    api.on('GET /internal/tickets/due', () => ({
      json: {
        items: [
          {
            ticketId: TICKET,
            requesterDiscordId: id(50),
            description: 'q',
            createdAt: '2026-11-02T10:00:00.000Z',
            reoffer: true,
            challenges: [{ supportDiscordId: id(61), challenge: challenge('ring') }],
          },
        ],
      },
    }));
    await make().tick();
    expect(discord.dmsTo(id(60))[0]!.msg.text).toBe('Через 5 минут ваш ПТ: 14:00–15:00');
    expect(api.called('POST /internal/pt/reminders/confirm')[0]!.body).toEqual({ slotId: SLOT });
    expect(discord.dmsTo(id(61))[0]!.msg.text).toContain('кольцо');
    expect(discord.logText()).toContain('предложен повторно');
  });

  it('survives API failures in both jobs, logs once per window, and runs the other job', async () => {
    api.on('GET /internal/pt/reminders', () => apiError(500, 'INTERNAL'));
    api.on('GET /internal/tickets/due', () => ({ json: { items: [] } }));
    const s = make();
    await expect(s.tick()).resolves.toBeUndefined();
    await expect(s.tick()).resolves.toBeUndefined();
    expect(api.called('GET /internal/tickets/due')).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(discord.logs.filter((l) => l.text.includes('Ошибка планировщика'))).toHaveLength(1);
    clock += 11 * 60_000;
    await s.tick();
    expect(discord.logs.filter((l) => l.text.includes('Ошибка планировщика'))).toHaveLength(2);
  });

  it('a malformed response or a broken log channel never throws', async () => {
    api.on('GET /internal/pt/reminders', () => ({ json: { nope: true } }));
    api.on('GET /internal/tickets/due', () => apiError(503, 'DISCORD_UNAVAILABLE'));
    discord.brokenLog = true;
    await expect(make().tick()).resolves.toBeUndefined();
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('one failing reminder DM does not stop the others', async () => {
    api.on('GET /internal/pt/reminders', () => ({
      json: {
        items: [
          { slotId: SLOT, startsAt: '2026-11-02T11:00:00.000Z', discordId: id(60), username: 'a' },
          { slotId: SLOT2, startsAt: '2026-11-02T11:00:00.000Z', discordId: id(61), username: 'b' },
        ],
      },
    }));
    api.on('GET /internal/tickets/due', () => ({ json: { items: [] } }));
    const original = discord.sendDm.bind(discord);
    discord.sendDm = async (u, m) => {
      if (u === id(60)) throw new Error('network');
      return original(u, m);
    };
    await make().tick();
    expect(discord.dmsTo(id(61))).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('does not overlap two passes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = createScheduler({
      api: {
        reminders: async () => {
          await gate;
          return { items: [] };
        },
        due: async () => ({ items: [] }),
        expire: async () => ({ items: [] }),
        confirmReminder: async () => {},
      },
      handlers: createHandlers({ api: api.client(), discord, store, config: CFG }),
      config: CFG,
    });
    const first = s.tick();
    await s.tick();
    release();
    await first;
  });
});

describe('reminders (minor)', () => {
  const reminder = (slotId = SLOT, discordId = id(60)) => ({
    json: { items: [{ slotId, startsAt: '2026-11-02T11:00:00.000Z', discordId, username: 's' }] },
  });
  const quiet = () => api.on('GET /internal/tickets/due', () => ({ json: { items: [] } }));

  it('computes the minutes left from the clock', async () => {
    quiet();
    api.on('GET /internal/pt/reminders', () => reminder());
    clock = START - 3 * 60_000;
    await make().tick();
    clock = START - 60_000;
    await make().tick();
    clock = START - 90_000;
    await make().tick();
    expect(discord.dmsTo(id(60)).map((d) => d.msg.text.split(' ваш')[0])).toEqual([
      'Через 3 минуты',
      'Через 1 минуту',
      'Через 2 минуты',
    ]);
  });

  it('does not confirm a failed send, so the next pass and a restarted bot send it again', async () => {
    quiet();
    api.on('GET /internal/pt/reminders', () => reminder());
    clock = START - 4 * 60_000;
    const original = discord.sendDm.bind(discord);
    discord.sendDm = async () => {
      throw new Error('network');
    };
    await make().tick();
    expect(api.called('POST /internal/pt/reminders/confirm')).toHaveLength(0);
    discord.sendDm = original;
    // A new scheduler is a restarted bot: nothing is remembered in it.
    await make().tick();
    expect(discord.dmsTo(id(60))).toHaveLength(1);
    expect(api.called('POST /internal/pt/reminders/confirm')).toHaveLength(1);
  });

  it('confirms a reminder to a person whose DMs are closed, so it is not retried forever', async () => {
    quiet();
    api.on('GET /internal/pt/reminders', () => reminder());
    clock = START - 4 * 60_000;
    discord.closedDms.add(id(60));
    await make().tick();
    expect(api.called('POST /internal/pt/reminders/confirm')).toHaveLength(1);
  });
});

describe('offer rounds (I6)', () => {
  const dueItem = (n: number) => ({
    ticketId: `${String(n).repeat(8)}-2222-4333-8444-555555555555`,
    requesterDiscordId: id(50),
    description: 'q',
    createdAt: '2026-11-02T10:00:00.000Z',
    reoffer: false,
    challenges: [{ supportDiscordId: id(61), challenge: challenge('ring') }],
  });

  it('backs the whole batch off for 10 minutes on Discord error 40003', async () => {
    api.on('GET /internal/pt/reminders', () => ({ json: { items: [] } }));
    api.on('GET /internal/tickets/due', () => ({ json: { items: [dueItem(1), dueItem(2)] } }));
    discord.sendDm = async () => {
      throw Object.assign(new Error('opening DMs too fast'), { code: 40003 });
    };
    const s = make();
    await s.tick();
    expect(api.called('GET /internal/tickets/due')).toHaveLength(1);
    expect(discord.logs.filter((l) => l.text.includes('Ошибка планировщика'))).toHaveLength(1);
    clock += 9 * 60_000;
    await s.tick();
    expect(api.called('GET /internal/tickets/due')).toHaveLength(1);
    clock += 2 * 60_000;
    await s.tick();
    expect(api.called('GET /internal/tickets/due')).toHaveLength(2);
  });

  it('closes tickets idle for 24 hours and announces them', async () => {
    api.on('GET /internal/pt/reminders', () => ({ json: { items: [] } }));
    api.on('GET /internal/tickets/due', () => ({ json: { items: [] } }));
    api.on('POST /internal/tickets/expire', () => ({
      json: {
        items: [
          { ticketId: TICKET, requesterDiscordId: id(50), claimerDiscordId: id(61), transcript: 'T', messageCount: 2 },
        ],
      },
    }));
    await make().tick();
    expect(discord.dmsTo(id(50))[0]!.msg.text).toContain('24 часа');
    expect(discord.dmsTo(id(61))[0]!.msg.text).toContain('24 часа');
    expect(discord.logs.some((l) => l.file?.content === 'T')).toBe(true);
  });
});
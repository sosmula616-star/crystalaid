import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers.js';
import { createScheduler } from './scheduler.js';
import { ApiStub, CFG, FakeDiscord, MemoryStore, TICKET, apiError, challenge, id } from './testing/kit.js';

let api: ApiStub;
let discord: FakeDiscord;
let store: MemoryStore;
let errors: unknown[];
let clock: number;

function make() {
  const handlers = createHandlers({ api: api.client(), discord, store, config: CFG, onError: (e) => errors.push(e) });
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
});
afterEach(() => api.stop());

describe('scheduler', () => {
  it('sends the PT reminder in the configured timezone and offers due tickets', async () => {
    api.on('GET /internal/pt/reminders', () => ({
      json: { items: [{ startsAt: '2026-11-02T11:00:00.000Z', discordId: id(60), username: 's' }] },
    }));
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
          { startsAt: '2026-11-02T11:00:00.000Z', discordId: id(60), username: 'a' },
          { startsAt: '2026-11-02T11:00:00.000Z', discordId: id(61), username: 'b' },
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

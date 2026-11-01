import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from './handlers.js';
import type { OutMessage } from './ports.js';
import { parseButton } from './text.js';
import { ApiStub, CFG, FakeDiscord, MemoryStore, TICKET, apiError, challenge, id } from './testing/kit.js';

const REQUESTER = id(50);
const SUPPORT_A = id(60);
const SUPPORT_B = id(61);

let api: ApiStub;
let discord: FakeDiscord;
let store: MemoryStore;
let errors: unknown[];
let h: ReturnType<typeof createHandlers>;

beforeEach(async () => {
  api = new ApiStub();
  await api.start();
  discord = new FakeDiscord();
  store = new MemoryStore();
  errors = [];
  h = createHandlers({ api: api.client(), discord, store, config: CFG, onError: (e) => errors.push(e) });
});
afterEach(() => api.stop());

const offered = () => [
  { supportDiscordId: SUPPORT_A, challenge: challenge('gem') },
  { supportDiscordId: SUPPORT_B, challenge: challenge('key') },
];
const createdBody = (challenges = offered()) => ({
  json: { ticketId: TICKET, requesterDiscordId: REQUESTER, challenges },
});

function replies() {
  const out: string[] = [];
  return { out, reply: async (t: string) => void out.push(t) };
}
function button(userId: string) {
  const updates: OutMessage[] = [];
  const notes: string[] = [];
  return {
    updates,
    notes,
    ctx: {
      userId,
      update: async (m: OutMessage) => void updates.push(m),
      notify: async (t: string) => void notes.push(t),
    },
  };
}

describe('/help', () => {
  it('opens the modal only in the help channel', async () => {
    const r = replies();
    let modals = 0;
    await h.handleHelpCommand({ channelId: CFG.channels.help, ...r, showModal: async () => void modals++ });
    expect(modals).toBe(1);
    expect(r.out).toEqual([]);

    await h.handleHelpCommand({ channelId: id(777), ...r, showModal: async () => void modals++ });
    expect(modals).toBe(1);
    expect(r.out[0]).toContain(`<#${CFG.channels.help}>`);
  });

  it('creates a ticket, tells the user the number, offers it with ordered images and index-only buttons', async () => {
    api.on('POST /internal/tickets', () => createdBody());
    const r = replies();
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'asker', text: '  как вступить?  ', ...r });

    const call = api.called('POST /internal/tickets')[0]!;
    expect(call.auth).toBe('Bearer service-token');
    expect(call.body).toEqual({ actorDiscordId: REQUESTER, username: 'asker', message: 'как вступить?' });

    expect(r.out[0]).toContain('#11111111');
    expect(discord.dmsTo(REQUESTER)[0]!.msg.text).toContain('#11111111');

    const offerA = discord.dmsTo(SUPPORT_A)[0]!.msg;
    expect(offerA.text).toBe('Новый тикет #11111111. Выберите: самоцвет');
    expect(offerA.images).toEqual(['gem', 'sword', 'key', 'bow']);
    expect(offerA.buttons!.map((b) => b.label)).toEqual(['1', '2', '3', '4']);
    for (const [i, b] of offerA.buttons!.entries()) {
      expect(b.id).toBe(`claim:${TICKET}:${i}`);
      expect(b.id).not.toMatch(/gem|sword|key|bow/);
      expect(parseButton(b.id)).toEqual({ kind: 'claim', ticketId: TICKET, index: i });
    }
    expect(discord.dmsTo(SUPPORT_B)[0]!.msg.text).toContain('ключ');
    expect(store.metas.get(TICKET)).toEqual({ description: 'как вступить?' });
    expect(store.offerMap.get(TICKET)).toHaveLength(2);
    expect(discord.logText()).toContain('Создан тикет #11111111');
    expect(discord.logText()).toContain('предложен');
  });

  it('says when nobody is on duty', async () => {
    api.on('POST /internal/tickets', () => createdBody([]));
    const r = replies();
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    expect(discord.dmsTo(REQUESTER)[0]!.msg.text).toContain('никого из поддержки нет на смене');
  });

  it('explains an open ticket and the cooldown in Russian', async () => {
    const r = replies();
    api.on('POST /internal/tickets', () => apiError(409, 'CONFLICT', 'open_ticket_exists'));
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    api.on('POST /internal/tickets', () => apiError(429, 'RATE_LIMITED', 'cooldown'));
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    api.on('POST /internal/tickets', () => apiError(500, 'INTERNAL'));
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    expect(r.out[0]).toContain('уже есть открытый тикет');
    expect(r.out[1]).toContain('раз в 5 минут');
    expect(r.out[2]).toContain('Не удалось создать тикет');
    expect(discord.dms).toEqual([]);
  });

  it('tells the user to open DMs when the DM fails, and logs it', async () => {
    api.on('POST /internal/tickets', () => createdBody());
    discord.closedDms.add(REQUESTER);
    const r = replies();
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    expect(r.out[0]).toContain('Откройте личные сообщения');
    expect(discord.logText()).toContain(`Не удалось доставить ЛС <@${REQUESTER}>`);
    // The offers still go out.
    expect(discord.dmsTo(SUPPORT_A)).toHaveLength(1);
  });
});

describe('DM failure wrapper', () => {
  it('logs 50007 and returns null, but rethrows other errors', async () => {
    discord.closedDms.add(SUPPORT_A);
    expect(await h.dm(SUPPORT_A, { text: 'x' }, 'проверка')).toBeNull();
    expect(discord.logText()).toContain('личные сообщения закрыты');
    discord.sendDm = async () => {
      throw Object.assign(new Error('boom'), { code: 40003 });
    };
    await expect(h.dm(SUPPORT_B, { text: 'x' }, 'проверка')).rejects.toThrow('boom');
  });

  it('keeps going when a support has closed DMs', async () => {
    discord.closedDms.add(SUPPORT_A);
    await h.offer(TICKET, 'q', offered());
    expect(discord.dmsTo(SUPPORT_B)).toHaveLength(1);
    expect(store.offerMap.get(TICKET)).toHaveLength(1);
    expect(discord.logText()).toContain(`<@${SUPPORT_A}>`);
  });
});

describe('claim', () => {
  beforeEach(async () => {
    await h.offer(TICKET, 'мой вопрос', offered());
    discord.logs = [];
  });

  it('claimed: shows the question and a close button, informs the user, logs, and closes other offers', async () => {
    api.on('POST /internal/tickets/:id/claim', () => ({ json: { result: 'claimed', requesterDiscordId: REQUESTER } }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 1 });

    expect(api.called('POST /internal/tickets/:id/claim')[0]!.body).toEqual({ actorDiscordId: SUPPORT_A, choiceIndex: 1 });
    expect(b.updates[0]!.text).toContain('мой вопрос');
    expect(b.updates[0]!.buttons).toEqual([{ id: `close:${TICKET}`, label: 'Закрыть тикет' }]);
    expect(discord.dmsTo(REQUESTER).at(-1)!.msg.text).toContain('подключился сотрудник поддержки');
    expect(discord.logText()).toContain(`принят: <@${SUPPORT_A}>`);
    // Only the other support's offer is edited.
    expect(discord.edits).toHaveLength(1);
    expect(discord.edits[0]!.ref.channelId).toBe(`dm-${SUPPORT_B}`);
    expect(discord.edits[0]!.msg.text).toBe('Тикет уже принят.');
  });

  it('wrong: says so, no more attempts, logs it', async () => {
    api.on('POST /internal/tickets/:id/claim', () => ({ json: { result: 'wrong' } }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    expect(b.updates[0]!.text).toContain('неверный');
    expect(b.updates[0]!.text).toContain('повторных попыток нет');
    expect(b.updates[0]!.buttons).toBeUndefined();
    expect(discord.logText()).toContain('Неверный ответ');
    expect(discord.edits).toEqual([]);
  });

  it('already_taken and closed edit the message', async () => {
    const b = button(SUPPORT_B);
    api.on('POST /internal/tickets/:id/claim', () => ({ json: { result: 'already_taken' } }));
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    api.on('POST /internal/tickets/:id/claim', () => ({ json: { result: 'closed' } }));
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    expect(b.updates.map((u) => u.text)).toEqual(['Тикет уже принят.', 'Тикет уже закрыт.']);
  });

  it('an API failure leaves the offer in place and notes it', async () => {
    api.on('POST /internal/tickets/:id/claim', () => apiError(403, 'FORBIDDEN'));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    expect(b.updates).toEqual([]);
    expect(b.notes).toHaveLength(1);
  });
});

describe('relay', () => {
  const dmFrom = (authorId: string, content: string, extra: { urls?: string[]; bot?: boolean } = {}) => {
    const r = replies();
    return {
      r,
      run: () =>
        h.handleDm({
          authorId,
          isBot: extra.bot ?? false,
          content,
          attachmentUrls: extra.urls ?? [],
          messageId: 'msg1',
          reply: r.reply,
        }),
    };
  };

  it('support to requester as «Поддержка: …», saved through the messages route', async () => {
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'support', counterpartDiscordId: REQUESTER } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => ({ json: { isStaff: true, recipientDiscordId: REQUESTER } }));
    await dmFrom(SUPPORT_A, 'Здравствуйте', { urls: ['https://cdn.example/a.png'] }).run();
    const saved = api.called('POST /internal/tickets/:id/messages')[0]!.body as { content: string; discordMessageId: string };
    expect(saved.content).toBe('Здравствуйте\nВложение: https://cdn.example/a.png');
    expect(saved.discordMessageId).toBe('msg1');
    expect(discord.dmsTo(REQUESTER)[0]!.msg.text).toBe('Поддержка: Здравствуйте\nВложение: https://cdn.example/a.png');
  });

  it('requester to support', async () => {
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'requester', counterpartDiscordId: SUPPORT_A } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => ({ json: { isStaff: false, recipientDiscordId: SUPPORT_A } }));
    await dmFrom(REQUESTER, 'Спасибо, а ещё вопрос').run();
    expect(discord.dmsTo(SUPPORT_A)[0]!.msg.text).toBe('Пользователь: Спасибо, а ещё вопрос');
  });

  it('hints when there is no active ticket, and ignores bots', async () => {
    api.on('GET /internal/tickets/active', () => ({ json: { ticket: null } }));
    const d = dmFrom(REQUESTER, 'привет');
    await d.run();
    expect(d.r.out[0]).toContain('нет активного тикета');
    expect(d.r.out[0]).toContain(`<#${CFG.channels.help}>`);

    const bot = dmFrom(REQUESTER, 'привет', { bot: true });
    const before = api.calls.length;
    await bot.run();
    expect(api.calls.length).toBe(before);
    expect(bot.r.out).toEqual([]);
  });

  it('does not forward while the ticket is unclaimed, and reports a closed ticket', async () => {
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'open', role: 'requester', counterpartDiscordId: null } },
    }));
    const a = dmFrom(REQUESTER, 'есть кто?');
    await a.run();
    expect(a.r.out[0]).toContain('ждёт сотрудника');
    expect(api.called('POST /internal/tickets/:id/messages')).toHaveLength(0);

    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'requester', counterpartDiscordId: SUPPORT_A } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => apiError(409, 'CONFLICT', 'ticket_closed'));
    const b = dmFrom(REQUESTER, 'ещё');
    await b.run();
    expect(b.r.out[0]).toContain('закрыт');
  });

  it('tells the author when the other side cannot be reached', async () => {
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'support', counterpartDiscordId: REQUESTER } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => ({ json: { isStaff: true, recipientDiscordId: REQUESTER } }));
    discord.closedDms.add(REQUESTER);
    const d = dmFrom(SUPPORT_A, 'привет');
    await d.run();
    expect(d.r.out[0]).toContain('доставить его не удалось');
    expect(discord.logText()).toContain('личные сообщения закрыты');
  });
});

describe('close and rating', () => {
  it('close: tells both sides, offers 1-5 and sends the transcript file with a summary to the log', async () => {
    api.on('POST /internal/tickets/:id/close', () => ({
      json: {
        ticketId: TICKET,
        requesterDiscordId: REQUESTER,
        transcript: 'Ticket x\n\n[10:00] user: hi\n[10:01] sup (support): hello',
      },
    }));
    const b = button(SUPPORT_A);
    await h.handleClose({ ...b.ctx, ticketId: TICKET });
    expect(b.updates[0]!.text).toContain('закрыт');
    const rate = discord.dmsTo(REQUESTER)[0]!.msg;
    expect(rate.buttons!.map((x) => x.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(parseButton(rate.buttons![4]!.id)).toEqual({ kind: 'rate', ticketId: TICKET, rating: 5 });
    const log = discord.logs[0]!;
    expect(log.file).toEqual({ name: 'ticket-11111111.txt', content: expect.stringContaining('hello') });
    expect(log.embed!.fields.find((f) => f.name === 'Сообщений')!.value).toBe('2');
  });

  it('close: a second close and a forbidden close are handled', async () => {
    const b = button(SUPPORT_B);
    api.on('POST /internal/tickets/:id/close', () => apiError(409, 'CONFLICT', 'ticket_closed'));
    await h.handleClose({ ...b.ctx, ticketId: TICKET });
    api.on('POST /internal/tickets/:id/close', () => apiError(403, 'FORBIDDEN'));
    await h.handleClose({ ...b.ctx, ticketId: TICKET });
    expect(b.updates[0]!.text).toContain('уже закрыт');
    expect(b.notes).toHaveLength(1);
    expect(discord.dms).toEqual([]);
  });

  it('close still logs the transcript when the user has closed DMs', async () => {
    api.on('POST /internal/tickets/:id/close', () => ({
      json: { ticketId: TICKET, requesterDiscordId: REQUESTER, transcript: 't' },
    }));
    discord.closedDms.add(REQUESTER);
    await h.handleClose({ ...button(SUPPORT_A).ctx, ticketId: TICKET });
    expect(discord.logs.some((l) => l.file)).toBe(true);
    expect(discord.logText()).toContain('личные сообщения закрыты');
  });

  it('rating: thanks, logs, and handles a repeat', async () => {
    api.on('POST /internal/tickets/:id/rating', () => ({ json: { ok: true } }));
    const b = button(REQUESTER);
    await h.handleRating({ ...b.ctx, ticketId: TICKET, rating: 4 });
    expect(api.called('POST /internal/tickets/:id/rating')[0]!.body).toEqual({ actorDiscordId: REQUESTER, rating: 4 });
    expect(b.updates[0]!.text).toContain('4 из 5');
    expect(discord.logText()).toContain('оценён: 4 из 5');
    api.on('POST /internal/tickets/:id/rating', () => apiError(409, 'CONFLICT', 'already_rated'));
    await h.handleRating({ ...b.ctx, ticketId: TICKET, rating: 5 });
    expect(b.updates[1]!.text).toContain('уже оценили');
  });
});

describe('log failures', () => {
  it('a broken log channel never breaks the flow', async () => {
    discord.brokenLog = true;
    api.on('POST /internal/tickets', () => createdBody());
    const r = replies();
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'a', text: 'q', ...r });
    expect(r.out[0]).toContain('#11111111');
    expect(errors.length).toBeGreaterThan(0);
  });
});

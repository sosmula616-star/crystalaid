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
  h = createHandlers({
    api: api.client(),
    discord,
    store,
    config: CFG,
    onError: (e) => errors.push(e),
    sleep: async () => {},
  });
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
      username: 'support_a',
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
    expect(discord.logText()).toContain(`Не удалось доставить ЛС a (${REQUESTER})`);
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
    await h.offer(TICKET, offered());
    expect(discord.dmsTo(SUPPORT_B)).toHaveLength(1);
    expect(store.offerMap.get(TICKET)).toHaveLength(1);
    expect(discord.logText()).toContain(SUPPORT_A);
  });
});

describe('claim', () => {
  beforeEach(async () => {
    await h.offer(TICKET, offered());
    discord.logs = [];
  });

  it('claimed: shows the question and a close button, informs the user, logs, and closes other offers', async () => {
    api.on('POST /internal/tickets/:id/claim', () => ({
      json: { result: 'claimed', requesterDiscordId: REQUESTER, description: 'мой вопрос' },
    }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 1 });

    expect(api.called('POST /internal/tickets/:id/claim')[0]!.body).toEqual({ actorDiscordId: SUPPORT_A, choiceIndex: 1 });
    expect(b.updates[0]!.text).toContain('мой вопрос');
    expect(b.updates[0]!.buttons).toEqual([{ id: `close:${TICKET}`, label: 'Закрыть тикет' }]);
    expect(discord.dmsTo(REQUESTER).at(-1)!.msg.text).toContain('подключился сотрудник поддержки');
    expect(discord.logText()).toContain(`принят: support\\_a (${SUPPORT_A})`);
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
  const dmFrom = (
    authorId: string,
    content: string,
    extra: { files?: { url: string; name: string; size: number }[]; bot?: boolean } = {},
  ) => {
    const r = replies();
    return {
      r,
      run: () =>
        h.handleDm({
          authorId,
          username: 'someone',
          isBot: extra.bot ?? false,
          content,
          attachments: extra.files ?? [],
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
    await dmFrom(SUPPORT_A, 'Здравствуйте', { files: [{ url: 'https://cdn.example/a.png', name: 'a.png', size: 1000 }] }).run();
    const saved = api.called('POST /internal/tickets/:id/messages')[0]!.body as { content: string; discordMessageId: string };
    // The copy in the log channel is what the transcript keeps; the other side gets the original link.
    expect(saved.content).toBe(
      `Здравствуйте\nВложение: a.png — https://discord.com/channels/${CFG.guildId}/${CFG.channels.log}/archive1`,
    );
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
        messageCount: 2,
        claimerDiscordId: SUPPORT_A,
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
      json: { ticketId: TICKET, requesterDiscordId: REQUESTER, transcript: 't', messageCount: 0, claimerDiscordId: null },
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

describe('one ticket at a time and a second press (C1, I1)', () => {
  beforeEach(async () => {
    await h.offer(TICKET, offered());
    discord.logs = [];
  });

  it('busy: asks to close the current ticket and keeps the offer alive', async () => {
    api.on('POST /internal/tickets/:id/claim', () => ({ json: { result: 'busy' } }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    expect(b.updates).toEqual([]);
    expect(b.notes).toEqual(['Сначала закройте текущий тикет.']);
    expect(discord.logs).toEqual([]);
  });

  it('yours: shows the claimed view with Close again, and neither writes to the user nor to the log', async () => {
    api.on('POST /internal/tickets/:id/claim', () => ({
      json: { result: 'yours', requesterDiscordId: REQUESTER, description: 'мой вопрос' },
    }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 2 });
    expect(b.updates[0]!.text).toContain('мой вопрос');
    expect(b.updates[0]!.buttons).toEqual([{ id: `close:${TICKET}`, label: 'Закрыть тикет' }]);
    expect(discord.dmsTo(REQUESTER)).toEqual([]);
    expect(discord.logs).toEqual([]);
    expect(discord.edits).toEqual([]);
  });
});

describe('cancel by the requester (C3)', () => {
  it('puts a Cancel button on the confirmation DM', async () => {
    api.on('POST /internal/tickets', () => createdBody());
    await h.handleHelpSubmit({ userId: REQUESTER, username: 'asker', text: 'q', ...replies() });
    const msg = discord.dmsTo(REQUESTER)[0]!.msg;
    expect(msg.buttons).toEqual([{ id: `cancel:${TICKET}`, label: 'Отменить' }]);
    expect(parseButton(msg.buttons![0]!.id)).toEqual({ kind: 'cancel', ticketId: TICKET });
  });

  it('cancelled: updates the DM, closes the support offers and logs it', async () => {
    await h.offer(TICKET, offered());
    discord.logs = [];
    api.on('POST /internal/tickets/:id/cancel', () => ({ json: { result: 'cancelled' } }));
    const b = button(REQUESTER);
    await h.handleCancel({ ...b.ctx, ticketId: TICKET });
    expect(api.called('POST /internal/tickets/:id/cancel')[0]!.body).toEqual({ actorDiscordId: REQUESTER });
    expect(b.updates[0]!.text).toContain('отменён');
    expect(b.updates[0]!.buttons).toBeUndefined();
    expect(discord.edits.map((e) => e.msg.text)).toEqual(['Тикет отменён.', 'Тикет отменён.']);
    expect(discord.logText()).toContain('отменён');
  });

  it('claimed and closed: explains and cancels nothing', async () => {
    const b = button(REQUESTER);
    api.on('POST /internal/tickets/:id/cancel', () => ({ json: { result: 'claimed' } }));
    await h.handleCancel({ ...b.ctx, ticketId: TICKET });
    api.on('POST /internal/tickets/:id/cancel', () => ({ json: { result: 'closed' } }));
    await h.handleCancel({ ...b.ctx, ticketId: TICKET });
    expect(b.updates[0]!.text).toContain('уже принят');
    expect(b.updates[1]!.text).toContain('уже закрыт');
    expect(discord.edits).toEqual([]);
  });

  it('a failure leaves the message and notes it', async () => {
    api.on('POST /internal/tickets/:id/cancel', () => apiError(500, 'INTERNAL'));
    const b = button(REQUESTER);
    await h.handleCancel({ ...b.ctx, ticketId: TICKET });
    expect(b.updates).toEqual([]);
    expect(b.notes).toHaveLength(1);
  });
});

describe('admin actions and the idle close (C3)', () => {
  const closed = {
    json: { ticketId: TICKET, requesterDiscordId: REQUESTER, claimerDiscordId: SUPPORT_A, transcript: 'T', messageCount: 3 },
  };

  it('adminClose closes, sends the rating prompt, tells the claimer and logs the transcript', async () => {
    api.on('POST /internal/tickets/:id/close', () => closed);
    const note = await h.adminClose(TICKET, id(20), 'boss');
    expect(note).toContain('закрыт');
    expect(api.called('POST /internal/tickets/:id/close')[0]!.body).toEqual({ actorDiscordId: id(20) });
    expect(discord.dmsTo(REQUESTER)[0]!.msg.buttons).toHaveLength(5);
    expect(discord.dmsTo(SUPPORT_A)[0]!.msg.text).toContain('администратором');
    expect(discord.logs.find((l) => l.file)!.embed!.fields.find((f) => f.name === 'Сообщений')!.value).toBe('3');
    expect(discord.logText()).toContain(`boss (${id(20)})`);
  });

  it('adminClose reports an already closed ticket and rethrows a refusal', async () => {
    api.on('POST /internal/tickets/:id/close', () => apiError(409, 'CONFLICT', 'ticket_closed'));
    expect(await h.adminClose(TICKET, id(20))).toContain('уже закрыт');
    api.on('POST /internal/tickets/:id/close', () => apiError(403, 'FORBIDDEN'));
    await expect(h.adminClose(TICKET, id(20))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('adminRelease tells both sides, logs, and the ticket is offered again by the scheduler', async () => {
    api.on('POST /internal/tickets/:id/release', () => ({
      json: { ticketId: TICKET, requesterDiscordId: REQUESTER, claimerDiscordId: SUPPORT_A },
    }));
    const note = await h.adminRelease(TICKET, id(20), 'boss');
    expect(note).toContain('возвращён');
    expect(discord.dmsTo(REQUESTER)[0]!.msg.text).toContain('возвращён в очередь');
    expect(discord.dmsTo(SUPPORT_A)[0]!.msg.text).toContain('передан');
    expect(discord.logText()).toContain('возвращён в очередь');
    api.on('POST /internal/tickets/:id/release', () => apiError(409, 'CONFLICT', 'not_claimed'));
    expect(await h.adminRelease(TICKET, id(20))).toContain('не в работе');
  });

  it('handleExpired tells both sides and writes the transcript to the log', async () => {
    await h.handleExpired({
      ticketId: TICKET,
      requesterDiscordId: REQUESTER,
      claimerDiscordId: SUPPORT_A,
      transcript: 'T',
      messageCount: 4,
    });
    expect(discord.dmsTo(REQUESTER)[0]!.msg.text).toContain('24 часа');
    expect(discord.dmsTo(SUPPORT_A)[0]!.msg.text).toContain('24 часа');
    const log = discord.logs.find((l) => l.file)!;
    expect(log.file).toEqual({ name: 'ticket-11111111.txt', content: 'T' });
    expect(log.embed!.fields.find((f) => f.name === 'Сообщений')!.value).toBe('4');
  });
});

describe('DMs the bot cannot deliver (I9)', () => {
  it('reports a closed DM to the API for the admin list, and still returns null', async () => {
    api.on('POST /internal/delivery-failures', () => ({ json: { ok: true } }));
    discord.closedDms.add(SUPPORT_A);
    expect(await h.dm(SUPPORT_A, { text: 'x' }, 'проверка')).toBeNull();
    expect(api.called('POST /internal/delivery-failures')[0]!.body).toEqual({
      targetDiscordId: SUPPORT_A,
      what: 'проверка',
      code: 50007,
    });
  });

  it('survives the report itself failing', async () => {
    api.on('POST /internal/delivery-failures', () => apiError(500, 'INTERNAL'));
    discord.closedDms.add(SUPPORT_A);
    expect(await h.dm(SUPPORT_A, { text: 'x' }, 'проверка')).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('offers under stress', () => {
  it('rethrows Discord error 40003 so the scheduler can back off the whole batch', async () => {
    discord.sendDm = async () => {
      throw Object.assign(new Error('too fast'), { code: 40003 });
    };
    await expect(h.offer(TICKET, offered())).rejects.toMatchObject({ code: 40003 });
  });

  it('keeps offering when Redis is down, and still takes the question from the API', async () => {
    store.broken = true;
    await h.offer(TICKET, offered());
    expect(discord.dmsTo(SUPPORT_A)).toHaveLength(1);
    expect(discord.dmsTo(SUPPORT_B)).toHaveLength(1);
    expect(errors.length).toBeGreaterThan(0);
    api.on('POST /internal/tickets/:id/claim', () => ({
      json: { result: 'claimed', requesterDiscordId: REQUESTER, description: 'из базы' },
    }));
    const b = button(SUPPORT_A);
    await h.handleClaim({ ...b.ctx, ticketId: TICKET, index: 0 });
    expect(b.updates[0]!.text).toContain('из базы');
  });
});

describe('relay details', () => {
  const run = (over: Partial<Parameters<typeof h.handleDm>[0]>) => {
    const r = replies();
    return {
      r,
      done: h.handleDm({
        authorId: REQUESTER,
        username: 'someone',
        isBot: false,
        content: '',
        attachments: [],
        messageId: 'm',
        reply: r.reply,
        ...over,
      }),
    };
  };

  it('tells the sender when the message has neither text nor a file', async () => {
    const x = run({ content: '   ' });
    await x.done;
    expect(x.r.out[0]).toContain('нет ни текста, ни файла');
    expect(api.calls).toEqual([]);
  });

  it('skips files over 25 MB with a note and keeps the original link', async () => {
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'support', counterpartDiscordId: REQUESTER } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => ({ json: { isStaff: true, recipientDiscordId: REQUESTER } }));
    await run({
      authorId: SUPPORT_A,
      content: 'вот',
      attachments: [{ url: 'https://cdn.example/big.zip', name: 'big.zip', size: 26 * 1024 * 1024 }],
    }).done;
    expect(discord.archived).toEqual([]);
    const saved = api.called('POST /internal/tickets/:id/messages')[0]!.body as { content: string };
    expect(saved.content).toBe('вот\nВложение: big.zip — больше 25 МБ, в логе нет копии: https://cdn.example/big.zip');
  });

  it('keeps the original link when the copy to the log fails', async () => {
    discord.brokenArchive = true;
    api.on('GET /internal/tickets/active', () => ({
      json: { ticket: { ticketId: TICKET, status: 'claimed', role: 'support', counterpartDiscordId: REQUESTER } },
    }));
    api.on('POST /internal/tickets/:id/messages', () => ({ json: { isStaff: true, recipientDiscordId: REQUESTER } }));
    await run({
      authorId: SUPPORT_A,
      attachments: [{ url: 'https://cdn.example/a.png', name: 'a.png', size: 10 }],
    }).done;
    const saved = api.called('POST /internal/tickets/:id/messages')[0]!.body as { content: string };
    expect(saved.content).toContain('копия в логе не сохранилась: https://cdn.example/a.png');
    expect(errors.length).toBeGreaterThan(0);
    expect(discord.dmsTo(REQUESTER)).toHaveLength(1);
  });
});

describe('transcript to the log', () => {
  const closeJson = () => ({
    json: { ticketId: TICKET, requesterDiscordId: REQUESTER, transcript: 'T', messageCount: 1, claimerDiscordId: null },
  });

  it('retries the send up to 3 times', async () => {
    api.on('POST /internal/tickets/:id/close', closeJson);
    discord.logFailures = 2;
    await h.handleClose({ ...button(SUPPORT_A).ctx, ticketId: TICKET });
    expect(discord.logs.some((l) => l.file)).toBe(true);
  });

  it('gives up after 3 attempts without breaking the close', async () => {
    api.on('POST /internal/tickets/:id/close', closeJson);
    discord.logFailures = 3;
    const b = button(SUPPORT_A);
    await h.handleClose({ ...b.ctx, ticketId: TICKET });
    expect(discord.logs.some((l) => l.file)).toBe(false);
    expect(b.updates[0]!.text).toContain('закрыт');
    expect(errors).toHaveLength(1);
  });
});
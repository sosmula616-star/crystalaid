import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Events, MessageFlags, Partials, type Client, type Interaction } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { ITEM_KEYS } from '@crystalaid/domain';
import {
  assertLogChannel,
  createClient,
  createDiscordPort,
  disableButtons,
  guildSource,
  handleMenuInteraction,
  renderOut,
  wire,
  wireResync,
} from './discord.js';
import type { Handlers } from './handlers.js';
import type { Menu } from './menu.js';
import type { Roster } from './roster.js';
import { ITEM_RU, claimId } from './text.js';
import { CFG, id } from './testing/kit.js';

describe('renderOut', () => {
  it('attaches the options as neutral names 1.png to 4.png and keeps item keys out of the payload', () => {
    const r = renderOut({
      text: 'Новый тикет #1. Выберите: меч',
      images: ['sword', 'gem', 'key', 'bow'],
      buttons: [0, 1, 2, 3].map((i) => ({ id: claimId('11111111-2222-4333-8444-555555555555', i), label: String(i + 1) })),
    });
    expect(r.files.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png', '4.png']);
    const json = JSON.stringify(r.components.map((c) => c.toJSON()));
    expect(json).toContain('attachment://1.png');
    expect(json).toContain('attachment://4.png');
    expect(json).not.toMatch(/sword|gem|"key"|bow/);
    expect(r.flags).toBe(1 << 15);
  });
});

describe('assets', () => {
  it('has a picture and a Russian name for every item key', () => {
    for (const key of ITEM_KEYS) {
      expect(existsSync(fileURLToPath(new URL(`../assets/captcha/${key}.png`, import.meta.url))), key).toBe(true);
      expect(ITEM_RU[key]).toBeTruthy();
    }
  });
});

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('client options (I5, I7)', () => {
  it('forbids every mention in every send, and keeps partial guild members', () => {
    const client = createClient(CFG, () => true);
    expect(client.options.allowedMentions).toEqual({ parse: [] });
    expect(client.options.partials).toEqual(expect.arrayContaining([Partials.GuildMember, Partials.Channel]));
    void client.destroy();
  });
});

describe('member events from another guild (C2)', () => {
  const member = (guildId: string, n = 70) => ({
    id: id(n),
    guild: { id: guildId },
    user: { username: `u${n}`, avatar: null },
    roles: { cache: new Map([[CFG.roles.support[0]!, {}]]) },
  });

  it('ignores update, available and remove from the log server, and handles the main guild', async () => {
    const bus = new EventEmitter();
    const calls: string[] = [];
    const roster = {
      memberUpdated: async (m: { userId: string }) => void calls.push(`u:${m.userId}`),
      memberRemoved: async (userId: string) => void calls.push(`r:${userId}`),
    } as unknown as Roster;
    wire(bus as unknown as Client, {} as Handlers, roster, () => {}, {} as Menu, CFG);
    const other = id(2);
    bus.emit(Events.GuildMemberUpdate, null, member(other));
    bus.emit(Events.GuildMemberAvailable, member(other));
    bus.emit(Events.GuildMemberRemove, member(other));
    await tick();
    expect(calls).toEqual([]);
    bus.emit(Events.GuildMemberUpdate, null, member(CFG.guildId));
    bus.emit(Events.GuildMemberAvailable, member(CFG.guildId, 71));
    bus.emit(Events.GuildMemberRemove, member(CFG.guildId, 72));
    await tick();
    expect(calls).toEqual([`u:${id(70)}`, `u:${id(71)}`, `r:${id(72)}`]);
  });
});

describe('/menu and /dev acknowledge first (I3)', () => {
  it('defers ephemerally before any API call, then edits the reply', async () => {
    for (const [name, call] of [['menu', 'open'], ['dev', 'openDev']] as const) {
      const order: string[] = [];
      let flags: unknown;
      const ix = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        isButton: () => false,
        isRepliable: () => true,
        commandName: name,
        user: { id: id(20), username: 'boss' },
        deferReply: async (o: { flags: unknown }) => {
          flags = o.flags;
          order.push('defer');
        },
        editReply: async () => void order.push('edit'),
        reply: async () => void order.push('reply'),
      };
      const menu = {
        [call]: async () => {
          order.push('api');
          return { view: { text: 'x', rows: [] } };
        },
      } as unknown as Menu;
      expect(await handleMenuInteraction(ix as unknown as Interaction, menu)).toBe(true);
      expect(order).toEqual(['defer', 'api', 'edit']);
      expect(flags).toBe(MessageFlags.Ephemeral);
    }
  });
});

describe('disableButtons (I1)', () => {
  it('turns off every button of a message and leaves the rest alone', () => {
    const before = [
      { type: 10, content: 'Новый тикет' },
      { type: 12, items: [{ media: { url: 'attachment://1.png' } }] },
      { type: 1, components: [{ type: 2, custom_id: 'claim:x:0', label: '1' }, { type: 2, custom_id: 'claim:x:1', label: '2' }] },
    ];
    const after = disableButtons(before) as typeof before;
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect((after[2] as unknown as { components: { disabled: boolean }[] }).components.map((b) => b.disabled)).toEqual([true, true]);
    expect((before[2] as unknown as { components: { disabled?: boolean }[] }).components[0]!.disabled).toBeUndefined();
  });
});

describe('log channel check at startup', () => {
  const clientWith = (fetch: () => Promise<unknown>) => ({ channels: { fetch }, user: { id: id(99) } }) as unknown as Client;
  const channel = (missing: string[]) => ({
    isSendable: () => true,
    permissionsFor: () => ({ missing: () => missing }),
  });

  it('passes for a channel the bot can write to', async () => {
    await expect(assertLogChannel(clientWith(async () => channel([])), CFG)).resolves.toBeUndefined();
  });

  it('names the channel and the problem when it is missing or cannot be written to', async () => {
    const gone = clientWith(async () => {
      throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
    });
    await expect(assertLogChannel(gone, CFG)).rejects.toThrow(new RegExp(`channels\\.log.*${CFG.channels.log}`));
    const noRights = clientWith(async () => channel(['SendMessages', 'AttachFiles']));
    await expect(assertLogChannel(noRights, CFG)).rejects.toThrow(/SendMessages, AttachFiles/);
    await expect(assertLogChannel(clientWith(async () => null), CFG)).rejects.toThrow(/channels\.log/);
  });
});

describe('resync after a lost session (I5)', () => {
  it('runs on an invalidated session and on a re-identify, but not on the first ready', () => {
    const bus = new EventEmitter();
    const reasons: string[] = [];
    let ready = false;
    wireResync(bus as unknown as Client, { trigger: (r) => void reasons.push(r) }, () => ready);
    bus.emit(Events.ShardReady, 0);
    expect(reasons).toEqual([]);
    ready = true;
    bus.emit(Events.Invalidated);
    bus.emit(Events.ShardReady, 0);
    expect(reasons).toEqual(['invalidated', 'reconnected']);
  });
});

describe('guild source (minor)', () => {
  const guildWith = (members: unknown) =>
    ({ guilds: { fetch: async () => ({ members }) } }) as unknown as Client;
  const gm = (n: number, roles: string[]) => ({
    id: id(n),
    user: { username: `u${n}`, avatar: null },
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
  });

  it('keeps only the members the filter accepts', async () => {
    const all = new Map([70, 71, 72].map((n) => [id(n), gm(n, n === 71 ? [CFG.roles.support[0]!] : [])]));
    const src = guildSource(guildWith({ fetch: async () => all }), CFG.guildId, () => {});
    const kept = await src.fetchAll((roleIds) => roleIds.includes(CFG.roles.support[0]!));
    expect(kept.map((m) => m.userId)).toEqual([id(71)]);
  });

  it('fetches listed users one by one and logs any Discord error instead of failing', async () => {
    const errs: unknown[] = [];
    const src = guildSource(
      guildWith({
        fetch: async (uid: string) => {
          if (uid === id(1)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
          if (uid === id(2)) throw Object.assign(new Error('rate limited'), { code: 429 });
          return gm(3, []);
        },
      }),
      CFG.guildId,
      (e) => errs.push(e),
    );
    const found = await src.fetchByIds([id(1), id(2), id(3)]);
    expect(found.map((m) => m.userId)).toEqual([id(3)]);
    expect(errs).toHaveLength(1);
  });
});

describe('copy of an attachment to the log channel (I8)', () => {
  it('downloads the file and posts it to the log channel without mentions', async () => {
    const sent: unknown[] = [];
    const client = {
      channels: {
        fetch: async () => ({
          isSendable: () => true,
          send: async (o: unknown) => {
            sent.push(o);
            return { url: 'https://discord.com/channels/1/2/3' };
          },
        }),
      },
    } as unknown as Client;
    const fetchStub = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const url = await createDiscordPort(client, CFG, fetchStub).archiveFile(
      { url: 'https://cdn.discordapp.com/attachments/1/2/a.png', name: 'a.png' },
      'вложение',
    );
    expect(url).toBe('https://discord.com/channels/1/2/3');
    expect(sent[0]).toMatchObject({ content: 'вложение', allowedMentions: { parse: [] } });
  });

  it('refuses an address that is not Discord’s CDN', async () => {
    const client = { channels: { fetch: async () => ({}) } } as unknown as Client;
    const fetchStub = (async () => {
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    await expect(
      createDiscordPort(client, CFG, fetchStub).archiveFile({ url: 'http://127.0.0.1/secret', name: 'x' }, 'c'),
    ).rejects.toThrow('not a Discord attachment');
  });
});
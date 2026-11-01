import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  Options,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  Partials,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type Interaction,
  type Message,
  type PartialGuildMember,
} from 'discord.js';
import type { ServerConfig } from '@crystalaid/config';
import type { DiscordPort, LogMessage, MenuResult, MenuView, ModalSpec, MsgRef, OutMessage } from './ports.js';
import { isMenuId, opensModal, type Menu } from './menu.js';
import type { Handlers } from './handlers.js';
import type { Roster, RosterMember } from './roster.js';
import { MODAL_ID, MODAL_INPUT_ID, MODAL_TITLE, parseButton } from './text.js';

const CAPTCHA_DIR = fileURLToPath(new URL('../assets/captcha/', import.meta.url));

/** A DM as a Components V2 message: text, the image gallery and one row of buttons. */
export function renderOut(msg: OutMessage) {
  const components: (TextDisplayBuilder | MediaGalleryBuilder | ActionRowBuilder<ButtonBuilder>)[] = [
    new TextDisplayBuilder().setContent(msg.text.slice(0, 4000)),
  ];
  const files: AttachmentBuilder[] = [];
  if (msg.images?.length) {
    // Neutral file names: nothing in the message tells which picture shows what.
    msg.images.forEach((key, i) => files.push(new AttachmentBuilder(`${CAPTCHA_DIR}${key}.png`, { name: `${i + 1}.png` })));
    components.push(
      new MediaGalleryBuilder().addItems(
        msg.images.map((_, i) => new MediaGalleryItemBuilder().setURL(`attachment://${i + 1}.png`).setDescription(`Вариант ${i + 1}`)),
      ),
    );
  }
  if (msg.buttons?.length) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        msg.buttons.map((b) => new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(ButtonStyle.Primary)),
      ),
    );
  }
  return { components, files, flags: MessageFlags.IsComponentsV2 as const };
}

const renderEdit = (msg: OutMessage) => ({ ...renderOut(msg), attachments: [] as never[] });

export function renderLog(msg: LogMessage) {
  return {
    content: msg.text.slice(0, 2000),
    ...(msg.embed
      ? { embeds: [new EmbedBuilder().setTitle(msg.embed.title).addFields(msg.embed.fields).setTimestamp()] }
      : {}),
    ...(msg.file ? { files: [new AttachmentBuilder(Buffer.from(msg.file.content, 'utf8'), { name: msg.file.name })] } : {}),
    allowedMentions: { parse: [] as never[] },
  };
}

type Cfg = Pick<ServerConfig, 'guildId' | 'channels' | 'roles' | 'users'>;

const roleIdsOf = (m: GuildMember | PartialGuildMember): string[] => [...m.roles.cache.keys()];
const toRoster = (m: GuildMember): RosterMember => ({
  userId: m.id,
  username: m.user.username,
  avatar: m.user.avatar,
  roleIds: roleIdsOf(m),
});

/**
 * The gateway client. The server has 300,000 members, so the member cache keeps only people the
 * roster cares about (branch roles, listed users) and a sweeper drops the rest.
 */
export function createClient(cfg: Cfg, isRelevant: (userId: string, roleIds: Iterable<string>) => boolean): Client {
  const keep = (m: GuildMember) => isRelevant(m.id, m.roles.cache.keys());
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
    // GuildMember: an update for a member who is not in the small cache still reaches the roster.
    partials: [Partials.Channel, Partials.GuildMember],
    // No send of this bot ever mentions anybody, whatever the text says.
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      PresenceManager: 0,
      ReactionManager: 0,
      GuildMemberManager: { maxSize: 0, keepOverLimit: keep },
      UserManager: { maxSize: 500 },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      guildMembers: { interval: 3600, filter: () => (m) => !keep(m) },
    },
  });
}

/** The Discord side of the handlers' ports. */
export function createDiscordPort(client: Client, cfg: Cfg, fetchImpl: typeof fetch = fetch): DiscordPort {
  return {
    async sendDm(userId: string, msg: OutMessage): Promise<MsgRef> {
      const user = await client.users.fetch(userId);
      const sent = await user.send(renderOut(msg));
      return { channelId: sent.channelId, messageId: sent.id };
    },
    async edit(ref: MsgRef, msg: OutMessage): Promise<void> {
      const ch = await client.channels.fetch(ref.channelId);
      if (ch?.isDMBased()) await ch.messages.edit(ref.messageId, renderEdit(msg));
    },
    async sendLog(msg: LogMessage): Promise<void> {
      const ch = await client.channels.fetch(cfg.channels.log);
      if (ch?.isSendable() && 'send' in ch) await ch.send(renderLog(msg));
    },
    async archiveFile(file: { url: string; name: string }, caption: string): Promise<string> {
      // Only Discord's own CDN: the address comes from a message, never from what a person typed.
      const host = new URL(file.url).hostname;
      if (!/(^|\.)(discordapp\.com|discordapp\.net|discord\.com)$/.test(host)) throw new Error('not a Discord attachment');
      const res = await fetchImpl(file.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      const ch = await client.channels.fetch(cfg.channels.log);
      if (!ch?.isSendable() || !('send' in ch)) throw new Error('log channel is not sendable');
      const sent = await ch.send({
        content: caption.slice(0, 2000),
        files: [new AttachmentBuilder(data, { name: file.name })],
        allowedMentions: { parse: [] },
      });
      return sent.url;
    },
  };
}

const LOG_PERMISSIONS = ['ViewChannel', 'SendMessages', 'AttachFiles', 'EmbedLinks'] as const;

/**
 * Checks `channels.log` at startup: the bot must be on the server with that channel and may write
 * files to it. Throws one clear error instead of a failure on the first ticket close.
 */
export async function assertLogChannel(client: Client, cfg: Pick<ServerConfig, 'channels'>): Promise<void> {
  const id = cfg.channels.log;
  let ch;
  try {
    ch = await client.channels.fetch(id);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `channels.log (${id}): канал недоступен (${why}). Бот должен быть приглашён на сервер с логом и видеть этот канал.`,
    );
  }
  if (!ch || !ch.isSendable()) {
    throw new Error(`channels.log (${id}): это не канал, в который можно писать. Укажите текстовый канал.`);
  }
  const perms = client.user ? (ch as { permissionsFor?: (u: unknown) => { missing(p: readonly string[]): string[] } | null }).permissionsFor?.(client.user) : null;
  const missing = perms ? perms.missing(LOG_PERMISSIONS) : [];
  if (missing.length > 0) {
    throw new Error(`channels.log (${id}): боту не хватает прав в канале: ${missing.join(', ')}.`);
  }
}

/**
 * Re-runs the roster snapshot when the gateway session was lost: events during the gap are gone.
 * The first ready is the startup snapshot's job, not this one's.
 */
export function wireResync(
  client: Pick<Client, 'on'>,
  runner: { trigger(reason: string): void },
  isReady: () => boolean,
): void {
  client.on(Events.Invalidated, () => runner.trigger('invalidated'));
  client.on(Events.ShardReady, () => {
    if (isReady()) runner.trigger('reconnected');
  });
}

function helpModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle(MODAL_TITLE)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(MODAL_INPUT_ID)
          .setLabel(MODAL_TITLE)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(300)
          .setRequired(true),
      ),
    );
}

/** The components of a message with every button switched off (rows and containers are searched). */
export function disableButtons(components: readonly unknown[]): unknown[] {
  return components.map((c) => {
    const o = c as { type?: number; components?: unknown[] };
    if (o.type === ComponentType.Button) return { ...o, disabled: true };
    if (Array.isArray(o.components)) return { ...o, components: disableButtons(o.components) };
    return c;
  });
}

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** Wires the gateway events to the handlers and the roster. Every listener catches its own errors. */
export function wire(
  client: Client,
  h: Handlers,
  roster: Roster,
  onError: (err: unknown, where: string) => void,
  menu: Menu,
  cfg: Pick<ServerConfig, 'guildId'>,
): void {
  const guard = <A extends unknown[]>(where: string, fn: (...a: A) => Promise<void>) =>
    (...a: A): void => void fn(...a).catch((err: unknown) => onError(err, where));
  // The bot also sits on the log server; its members are not our staff and must not reach the roster.
  const ours = (m: { guild: { id: string } }): boolean => m.guild.id === cfg.guildId;

  client.on(
    Events.GuildMemberUpdate,
    guard('member update', async (_old, m) => {
      if (!ours(m)) return;
      await roster.memberUpdated(toRoster(m as GuildMember));
    }),
  );
  // A member who is not in the cache arrives here, not in guildMemberUpdate.
  client.on(
    Events.GuildMemberAvailable,
    guard('member available', async (m) => {
      if (!ours(m)) return;
      await roster.memberUpdated(toRoster(m as GuildMember));
    }),
  );
  client.on(
    Events.GuildMemberRemove,
    guard('member remove', async (m) => {
      if (!ours(m)) return;
      await roster.memberRemoved(m.id, roleIdsOf(m));
    }),
  );

  client.on(
    Events.InteractionCreate,
    guard('interaction', async (i: Interaction) => {
      if (await handleMenuInteraction(i, menu)) return;
      if (i.isChatInputCommand()) {
        if (i.commandName === 'help') {
          await h.handleHelpCommand({
            channelId: i.channelId,
            reply: async (t) => {
              await i.reply(ephemeral(t));
            },
            showModal: async () => {
              await i.showModal(helpModal());
            },
          });
        } else {
          await i.reply(ephemeral('Скоро'));
        }
      } else if (i.isModalSubmit() && i.customId === MODAL_ID) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await h.handleHelpSubmit({
          userId: i.user.id,
          username: i.user.username,
          text: i.fields.getTextInputValue(MODAL_INPUT_ID),
          reply: async (t) => void (await i.editReply({ content: t })),
        });
      } else if (i.isButton()) {
        const b = parseButton(i.customId);
        if (!b) return;
        await i.deferUpdate();
        // First press: the buttons go off at once, so a second click cannot start a second action.
        // If the handler leaves the message as it is (a note, an error), the buttons come back.
        const original = i.message.components.map((c) => c.toJSON());
        const setComponents = async (components: unknown[]) => {
          try {
            await i.editReply({ components: components as never, flags: MessageFlags.IsComponentsV2 });
          } catch (err) {
            onError(err, 'button state');
          }
        };
        let replaced = false;
        await setComponents(disableButtons(original));
        const ctx = {
          userId: i.user.id,
          username: i.user.username,
          update: async (m: OutMessage) => {
            replaced = true;
            await i.editReply(renderEdit(m));
          },
          notify: async (t: string) => void (await i.followUp(ephemeral(t))),
        };
        try {
          if (b.kind === 'claim') await h.handleClaim({ ...ctx, ticketId: b.ticketId, index: b.index });
          else if (b.kind === 'close') await h.handleClose({ ...ctx, ticketId: b.ticketId });
          else if (b.kind === 'cancel') await h.handleCancel({ ...ctx, ticketId: b.ticketId });
          else await h.handleRating({ ...ctx, ticketId: b.ticketId, rating: b.rating });
        } finally {
          if (!replaced) await setComponents(original);
        }
      }
    }),
  );

  client.on(
    Events.MessageCreate,
    guard('dm message', async (m: Message) => {
      if (m.author.bot || !m.channel.isDMBased()) return;
      await h.handleDm({
        authorId: m.author.id,
        username: m.author.username,
        isBot: m.author.bot,
        content: m.content,
        attachments: [...m.attachments.values()].map((a) => ({ url: a.url, name: a.name, size: a.size })),
        messageId: m.id,
        reply: async (t) => {
          await m.author.send({ content: t });
        },
      });
    }),
  );
}

/** Members of the guild for the snapshot: those that pass a filter, and some by id. */
export function guildSource(client: Client, guildId: string, onError: (err: unknown, where: string) => void) {
  return {
    async fetchAll(keep: (roleIds: string[]) => boolean): Promise<RosterMember[]> {
      const guild = await client.guilds.fetch(guildId);
      const all = await guild.members.fetch({ time: 10 * 60_000 });
      // Only the members that pass the filter become rows: the rest are never mapped.
      const out: RosterMember[] = [];
      for (const m of all.values()) if (keep(roleIdsOf(m))) out.push(toRoster(m));
      return out;
    },
    async fetchByIds(ids: string[]): Promise<RosterMember[]> {
      const guild = await client.guilds.fetch(guildId);
      const found: RosterMember[] = [];
      // One request per id. Whatever Discord answers for one person (not on the server, rate
      // limit, a timeout) is logged and skipped; it must not cost the snapshot the others.
      for (const id of ids) {
        try {
          found.push(toRoster(await guild.members.fetch(id)));
        } catch (err) {
          if ((err as { code?: number }).code !== 10007) onError(err, `fetch listed user ${id}`); // 10007: Unknown Member
        }
      }
      return found;
    },
  };
}

const STYLE = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;

/** A menu as plain content with component rows. It mentions nobody. */
export function renderMenu(view: MenuView) {
  const components = view.rows.map((row) => {
    if (row.kind === 'buttons') {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.buttons.map((b) =>
          new ButtonBuilder()
            .setCustomId(b.id)
            .setLabel(b.label)
            .setStyle(STYLE[b.style ?? 'primary'])
            .setDisabled(b.disabled ?? false),
        ),
      );
    }
    if (row.kind === 'user') {
      return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId(row.id).setPlaceholder(row.placeholder).setMinValues(1).setMaxValues(1),
      );
    }
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(row.id)
        .setPlaceholder(row.placeholder)
        .setMinValues(row.min)
        .setMaxValues(row.max)
        .addOptions(row.options.slice(0, 25).map((o) => ({ label: o.label, value: o.value, default: o.default ?? false }))),
    );
  });
  return { content: view.text.slice(0, 2000), components, allowedMentions: { parse: [] as never[] } };
}

export function renderModal(spec: ModalSpec): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(spec.id)
    .setTitle(spec.title.slice(0, 45))
    .addComponents(
      spec.inputs.map((inp) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(inp.id)
            .setLabel(inp.label.slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setRequired(inp.required)
            .setMaxLength(inp.maxLength)
            .setValue(inp.value ?? ''),
        ),
      ),
    );
}


/**
 * Sends a menu result. `deferred` is how the interaction was acknowledged: 'update' edits the menu
 * message, 'reply' answers a fresh ephemeral message; with none, the answer is the first response.
 */
async function answerMenu(i: Interaction, r: MenuResult, deferred: 'update' | 'reply' | null): Promise<void> {
  if (!i.isRepliable()) return;
  const x = i as unknown as {
    reply(o: object): Promise<unknown>;
    update?(o: object): Promise<unknown>;
    editReply(o: object): Promise<unknown>;
    followUp(o: object): Promise<unknown>;
    showModal?(m: ModalBuilder): Promise<unknown>;
  };
  if ('modal' in r) {
    await x.showModal?.(renderModal(r.modal));
  } else if ('note' in r) {
    if (deferred === 'update') await x.followUp(ephemeral(r.note));
    else if (deferred === 'reply') await x.editReply({ content: r.note });
    else await x.reply(ephemeral(r.note));
  } else if (deferred) {
    await x.editReply(renderMenu(r.view));
  } else if (x.update) {
    await x.update(renderMenu(r.view));
  } else {
    await x.reply({ ...renderMenu(r.view), flags: MessageFlags.Ephemeral });
  }
}

/** Routes `/menu`, `/dev` and every menu component. Returns true when the interaction was a menu one. */
export async function handleMenuInteraction(i: Interaction, menu: Menu): Promise<boolean> {
  if (i.isChatInputCommand() && (i.commandName === 'menu' || i.commandName === 'dev')) {
    // Acknowledge first: the API call may take longer than the 3 seconds Discord allows.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await (i.commandName === 'menu' ? menu.open({ userId: i.user.id }) : menu.openDev({ userId: i.user.id }));
    await answerMenu(i, r, 'reply');
    return true;
  }
  if (i.isModalSubmit() && isMenuId(i.customId)) {
    const fields: Record<string, string> = {};
    for (const [k, f] of i.fields.fields) if ('value' in f && typeof f.value === 'string') fields[k] = f.value;
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await menu.interact({ userId: i.user.id, username: i.user.username, customId: i.customId, fields });
    await answerMenu(i, r, i.isFromMessage() ? 'update' : 'reply');
    return true;
  }
  if ((i.isButton() || i.isStringSelectMenu() || i.isUserSelectMenu()) && isMenuId(i.customId)) {
    const values = i.isButton() ? [] : i.values;
    const modal = opensModal(i.customId);
    if (!modal) await i.deferUpdate();
    const r = await menu.interact({ userId: i.user.id, username: i.user.username, customId: i.customId, values });
    await answerMenu(i, r, modal ? null : 'update');
    return true;
  }
  return false;
}

import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  Options,
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
import type { DiscordPort, LogMessage, MsgRef, OutMessage } from './ports.js';
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
    partials: [Partials.Channel],
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
export function createDiscordPort(client: Client, cfg: Cfg): DiscordPort {
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
  };
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

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

/** Wires the gateway events to the handlers and the roster. Every listener catches its own errors. */
export function wire(
  client: Client,
  h: Handlers,
  roster: Roster,
  onError: (err: unknown, where: string) => void,
): void {
  const guard = <A extends unknown[]>(where: string, fn: (...a: A) => Promise<void>) =>
    (...a: A): void => void fn(...a).catch((err: unknown) => onError(err, where));

  client.on(Events.GuildMemberUpdate, guard('member update', async (_old, m) => roster.memberUpdated(toRoster(m as GuildMember))));
  // A member who is not in the cache arrives here, not in guildMemberUpdate.
  client.on(Events.GuildMemberAvailable, guard('member available', async (m) => roster.memberUpdated(toRoster(m as GuildMember))));
  client.on(Events.GuildMemberRemove, guard('member remove', async (m) => roster.memberRemoved(m.id, roleIdsOf(m))));

  client.on(
    Events.InteractionCreate,
    guard('interaction', async (i: Interaction) => {
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
        const ctx = {
          userId: i.user.id,
          update: async (m: OutMessage) => void (await i.editReply(renderEdit(m))),
          notify: async (t: string) => void (await i.followUp(ephemeral(t))),
        };
        if (b.kind === 'claim') await h.handleClaim({ ...ctx, ticketId: b.ticketId, index: b.index });
        else if (b.kind === 'close') await h.handleClose({ ...ctx, ticketId: b.ticketId });
        else await h.handleRating({ ...ctx, ticketId: b.ticketId, rating: b.rating });
      }
    }),
  );

  client.on(
    Events.MessageCreate,
    guard('dm message', async (m: Message) => {
      if (m.author.bot || !m.channel.isDMBased()) return;
      await h.handleDm({
        authorId: m.author.id,
        isBot: m.author.bot,
        content: m.content,
        attachmentUrls: [...m.attachments.values()].map((a) => a.url),
        messageId: m.id,
        reply: async (t) => {
          await m.author.send({ content: t });
        },
      });
    }),
  );
}

/** Members of the guild for the snapshot: all of them, and some by id. */
export function guildSource(client: Client, guildId: string) {
  return {
    async fetchAll(): Promise<RosterMember[]> {
      const guild = await client.guilds.fetch(guildId);
      const all = await guild.members.fetch({ time: 10 * 60_000 });
      return all.map(toRoster);
    },
    async fetchByIds(ids: string[]): Promise<RosterMember[]> {
      const guild = await client.guilds.fetch(guildId);
      const found: RosterMember[] = [];
      // One request per id: an id that is not on the server is skipped, not an error for the rest.
      for (const id of ids) {
        try {
          found.push(toRoster(await guild.members.fetch(id)));
        } catch (err) {
          if ((err as { code?: number }).code !== 10007) throw err; // Unknown Member
        }
      }
      return found;
    },
  };
}

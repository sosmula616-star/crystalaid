import type { ServerConfig } from '@crystalaid/config';
import type { ItemKey } from '@crystalaid/domain';
import { ApiError, type ApiClient } from './api.js';
import type {
  ButtonCtx,
  DiscordPort,
  LogMessage,
  MsgRef,
  OfferStore,
  Offered,
  OutMessage,
  Replier,
} from './ports.js';
import { ITEM_RU, claimId, closeId, rateId, shortId } from './text.js';

/** Longest text the bot passes on: the API stores up to 4000, and the prefix needs room. */
const MAX_RELAY = 3900;
export const DM_CLOSED = 50007;

export interface HandlerDeps {
  api: Pick<ApiClient, 'createTicket' | 'claim' | 'addMessage' | 'close' | 'rate' | 'active'>;
  discord: DiscordPort;
  store: OfferStore;
  config: Pick<ServerConfig, 'channels'>;
  /** Fallback for errors that cannot reach the log channel. */
  onError?: (err: unknown, where: string) => void;
}

export const isDmClosed = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DM_CLOSED;

export function createHandlers(deps: HandlerDeps) {
  const { api, discord, store, config } = deps;
  const onError = deps.onError ?? ((err, where) => console.error(`[bot] ${where}:`, err));

  /** The log must never break the flow it describes. */
  async function log(msg: LogMessage | string): Promise<void> {
    try {
      await discord.sendLog(typeof msg === 'string' ? { text: msg } : msg);
    } catch (err) {
      onError(err, 'log channel');
    }
  }

  /**
   * The only way to DM a person. A closed DM (50007) is written to the log and gives `null`;
   * every other error is thrown to the caller.
   */
  async function dm(userId: string, msg: OutMessage, what: string): Promise<MsgRef | null> {
    try {
      return await discord.sendDm(userId, msg);
    } catch (err) {
      if (!isDmClosed(err)) throw err;
      await log(`Не удалось доставить ЛС <@${userId}> (${what}): личные сообщения закрыты.`);
      return null;
    }
  }

  const apiReason = (err: unknown): string | null => (err instanceof ApiError ? (err.reason ?? err.code) : null);

  // ---------- /help ----------

  /** `showModal` opens the question form. Only in the help channel. */
  async function handleHelpCommand(ix: {
    channelId: string | null;
    reply(text: string): Promise<void>;
    showModal(): Promise<void>;
  }): Promise<void> {
    if (ix.channelId !== config.channels.help) {
      await ix.reply(`Команда /help работает только в канале <#${config.channels.help}>. Напишите её там.`);
      return;
    }
    await ix.showModal();
  }

  async function offer(ticketId: string, description: string, challenges: Offered, reoffer = false): Promise<void> {
    if (challenges.length === 0) return;
    await store.remember(ticketId, { description });
    const names: string[] = [];
    for (const { supportDiscordId, challenge } of challenges) {
      const msg: OutMessage = {
        text: `Новый тикет #${shortId(ticketId)}. Выберите: ${ITEM_RU[challenge.target as ItemKey] ?? challenge.target}`,
        images: challenge.options,
        buttons: challenge.options.map((_, i) => ({ id: claimId(ticketId, i), label: String(i + 1) })),
      };
      try {
        const ref = await dm(supportDiscordId, msg, `тикет #${shortId(ticketId)}`);
        if (ref) {
          await store.addOffer(ticketId, supportDiscordId, ref);
          names.push(`<@${supportDiscordId}>`);
        }
      } catch (err) {
        onError(err, 'offer');
        await log(`Не удалось отправить предложение тикета #${shortId(ticketId)} <@${supportDiscordId}>.`);
      }
    }
    await log(
      `Тикет #${shortId(ticketId)} ${reoffer ? 'предложен повторно' : 'предложен'}: ${names.join(', ') || 'никому не доставлен'}.`,
    );
  }

  async function handleHelpSubmit(ix: Replier & { userId: string; username: string; text: string }): Promise<void> {
    const question = ix.text.trim();
    let created;
    try {
      created = await api.createTicket({ actorDiscordId: ix.userId, username: ix.username, message: question });
    } catch (err) {
      const why = apiReason(err);
      if (why === 'open_ticket_exists') {
        await ix.reply('У вас уже есть открытый тикет. Дождитесь ответа в личных сообщениях с ботом.');
      } else if (why === 'cooldown') {
        await ix.reply('Новый тикет можно создать не чаще, чем раз в 5 минут. Попробуйте чуть позже.');
      } else {
        onError(err, 'create ticket');
        await ix.reply('Не удалось создать тикет. Попробуйте позже.');
      }
      return;
    }
    const n = shortId(created.ticketId);
    await log(`Создан тикет #${n} от <@${ix.userId}>: ${question}`);
    const waiting = created.challenges.length === 0;
    let ref: MsgRef | null = null;
    try {
      ref = await dm(
        ix.userId,
        {
          text:
            `Ваш тикет #${n} создан.\n` +
            (waiting
              ? 'Сейчас никого из поддержки нет на смене. Тикет дождётся ближайшей смены и будет предложен снова.'
              : 'Скоро к вам подключится сотрудник поддержки. Переписка идёт здесь, в личных сообщениях.'),
        },
        `тикет #${n}`,
      );
    } catch (err) {
      onError(err, 'dm requester');
    }
    await ix.reply(
      ref
        ? `Тикет #${n} создан. Дальше мы общаемся в личных сообщениях с ботом.`
        : `Тикет #${n} создан, но я не могу написать вам в личные сообщения. Откройте личные сообщения для участников сервера в настройках приватности, иначе поддержка не сможет вам ответить.`,
    );
    await offer(created.ticketId, question, created.challenges);
  }

  // ---------- claim ----------

  async function handleClaim(ix: ButtonCtx & { ticketId: string; index: number }): Promise<void> {
    const n = shortId(ix.ticketId);
    let r;
    try {
      r = await api.claim(ix.ticketId, ix.userId, ix.index);
    } catch (err) {
      onError(err, 'claim');
      await ix.notify('Не удалось обработать ответ. Попробуйте ещё раз позже.');
      return;
    }
    if (r.result === 'wrong') {
      await ix.update({ text: `Выбор неверный. Тикет #${n} вам недоступен, повторных попыток нет.` });
      await log(`Неверный ответ на проверку тикета #${n}: <@${ix.userId}>.`);
    } else if (r.result === 'already_taken') {
      await ix.update({ text: 'Тикет уже принят.' });
    } else if (r.result === 'closed') {
      await ix.update({ text: 'Тикет уже закрыт.' });
    } else {
      const meta = await store.meta(ix.ticketId);
      await ix.update({
        text: `Вы приняли тикет #${n}.\n\nВопрос:\n${meta?.description ?? '(текст вопроса больше недоступен)'}\n\nПишите ответ сюда, я передам его пользователю.`,
        buttons: [{ id: closeId(ix.ticketId), label: 'Закрыть тикет' }],
      });
      if (r.requesterDiscordId) {
        try {
          await dm(
            r.requesterDiscordId,
            { text: `К вашему тикету #${n} подключился сотрудник поддержки. Пишите сюда, он ответит.` },
            `тикет #${n}`,
          );
        } catch (err) {
          onError(err, 'dm requester');
        }
      }
      await log(`Тикет #${n} принят: <@${ix.userId}>.`);
      for (const other of await store.offers(ix.ticketId)) {
        if (other.userId === ix.userId) continue;
        try {
          await discord.edit(other.ref, { text: 'Тикет уже принят.' });
        } catch (err) {
          onError(err, 'edit offer');
        }
      }
    }
  }

  // ---------- relay ----------

  const attachmentLines = (urls: string[]): string => urls.map((u) => `Вложение: ${u}`).join('\n');

  /** A DM written to the bot. Ignores bots. */
  async function handleDm(ix: {
    authorId: string;
    isBot: boolean;
    content: string;
    attachmentUrls: string[];
    messageId: string;
    reply(text: string): Promise<void>;
  }): Promise<void> {
    if (ix.isBot) return;
    const text = [ix.content.trim(), attachmentLines(ix.attachmentUrls)].filter(Boolean).join('\n').slice(0, MAX_RELAY);
    if (!text) return;
    let active;
    try {
      active = await api.active(ix.authorId);
    } catch (err) {
      onError(err, 'active ticket');
      await ix.reply('Сейчас не получается обработать сообщение. Попробуйте позже.');
      return;
    }
    if (!active) {
      await ix.reply(`У вас нет активного тикета. Чтобы задать вопрос, напишите /help в канале <#${config.channels.help}>.`);
      return;
    }
    if (active.status === 'open') {
      await ix.reply('Ваш тикет ждёт сотрудника поддержки. Когда он подключится, вы сможете ему написать.');
      return;
    }
    let saved;
    try {
      saved = await api.addMessage(active.ticketId, ix.authorId, text, ix.messageId);
    } catch (err) {
      if (apiReason(err) === 'ticket_closed') {
        await ix.reply('Этот тикет уже закрыт.');
      } else {
        onError(err, 'save message');
        await ix.reply('Не удалось сохранить сообщение. Попробуйте ещё раз.');
      }
      return;
    }
    if (!saved.recipientDiscordId) {
      await ix.reply('Пока некому передать сообщение.');
      return;
    }
    const out = saved.isStaff ? `Поддержка: ${text}` : `Пользователь: ${text}`;
    let sent: MsgRef | null = null;
    try {
      sent = await dm(saved.recipientDiscordId, { text: out }, `сообщение по тикету #${shortId(active.ticketId)}`);
    } catch (err) {
      onError(err, 'relay');
    }
    if (!sent) await ix.reply('Сообщение сохранено, но доставить его не удалось.');
  }

  // ---------- close and rating ----------

  async function handleClose(ix: ButtonCtx & { ticketId: string }): Promise<void> {
    const n = shortId(ix.ticketId);
    let r;
    try {
      r = await api.close(ix.ticketId, ix.userId);
    } catch (err) {
      if (apiReason(err) === 'ticket_closed') {
        await ix.update({ text: `Тикет #${n} уже закрыт.` });
      } else {
        onError(err, 'close');
        await ix.notify('Не удалось закрыть тикет.');
      }
      return;
    }
    await ix.update({ text: `Тикет #${n} закрыт. Спасибо за работу!` });
    try {
      await dm(
        r.requesterDiscordId,
        {
          text: `Тикет #${n} закрыт. Оцените помощь поддержки от 1 до 5.`,
          buttons: [1, 2, 3, 4, 5].map((v) => ({ id: rateId(ix.ticketId, v), label: String(v) })),
        },
        `закрытие тикета #${n}`,
      );
    } catch (err) {
      onError(err, 'dm requester');
    }
    await log({
      text: `Тикет #${n} закрыт.`,
      file: { name: `ticket-${n}.txt`, content: r.transcript },
      embed: {
        title: `Тикет #${n} закрыт`,
        fields: [
          { name: 'Пользователь', value: `<@${r.requesterDiscordId}>` },
          { name: 'Закрыл', value: `<@${ix.userId}>` },
          { name: 'Сообщений', value: String(r.transcript.split('\n').filter((l) => l.startsWith('[')).length) },
        ],
      },
    });
  }

  async function handleRating(ix: ButtonCtx & { ticketId: string; rating: number }): Promise<void> {
    const n = shortId(ix.ticketId);
    try {
      await api.rate(ix.ticketId, ix.userId, ix.rating);
    } catch (err) {
      if (apiReason(err) === 'already_rated') {
        await ix.update({ text: 'Вы уже оценили этот тикет.' });
      } else {
        onError(err, 'rate');
        await ix.notify('Не удалось сохранить оценку.');
      }
      return;
    }
    await ix.update({ text: `Спасибо за оценку: ${ix.rating} из 5.` });
    await log(`Тикет #${n} оценён: ${ix.rating} из 5 (<@${ix.userId}>).`);
  }

  return { handleHelpCommand, handleHelpSubmit, handleClaim, handleDm, handleClose, handleRating, offer, dm, log };
}

export type Handlers = ReturnType<typeof createHandlers>;

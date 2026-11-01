import type { ServerConfig } from '@crystalaid/config';
import type { ItemKey } from '@crystalaid/domain';
import { ApiError, type ApiClient } from './api.js';
import type {
  Attachment,
  ButtonCtx,
  DiscordPort,
  LogMessage,
  MsgRef,
  OfferStore,
  Offered,
  OutMessage,
  Replier,
} from './ports.js';
import { ITEM_RU, cancelId, claimId, closeId, rateId, shortId } from './text.js';

/** Longest text the bot passes on: the API stores up to 4000, and the prefix needs room. */
const MAX_RELAY = 3900;
/** Discord's limit for a file of a bot without boosts; bigger files are not copied to the log. */
export const ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
const LOG_ATTEMPTS = 3;
const NAME_CACHE_MAX = 5000;
export const DM_CLOSED = 50007;
/** "You are opening direct messages too fast". */
export const DM_TOO_FAST = 40003;

export interface HandlerDeps {
  api: Pick<
    ApiClient,
    'createTicket' | 'claim' | 'addMessage' | 'close' | 'rate' | 'active' | 'cancel' | 'release' | 'reportDelivery'
  >;
  discord: DiscordPort;
  store: OfferStore;
  config: Pick<ServerConfig, 'channels'>;
  /** Fallback for errors that cannot reach the log channel. */
  onError?: (err: unknown, where: string) => void;
  /** Pause between attempts to send a transcript; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const codeOf = (err: unknown): number | null => {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'number' ? code : null;
};

export const isDmClosed = (err: unknown): boolean => codeOf(err) === DM_CLOSED;
export const isDmTooFast = (err: unknown): boolean => codeOf(err) === DM_TOO_FAST;

/** Escapes what Discord would render as markup in a name. */
const esc = (t: string): string => t.slice(0, 40).replace(/[\\*_`~|>@<[\]]/g, '\\$&');

export function createHandlers(deps: HandlerDeps) {
  const { api, discord, store, config } = deps;
  const onError = deps.onError ?? ((err, where) => console.error(`[bot] ${where}:`, err));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // The log server does not know the people of the main server, so a mention would show as a raw
  // id there. The log names people as "username (id)"; usernames are learned from interactions.
  const names = new Map<string, string>();
  function rememberName(userId: string, name?: string): void {
    if (!name) return;
    names.delete(userId);
    names.set(userId, name);
    if (names.size > NAME_CACHE_MAX) names.delete(names.keys().next().value!);
  }
  const who = (userId: string): string => {
    const name = names.get(userId);
    return name ? `${esc(name)} (${userId})` : userId;
  };

  /** The log must never break the flow it describes. */
  async function log(msg: LogMessage | string): Promise<void> {
    try {
      await discord.sendLog(typeof msg === 'string' ? { text: msg } : msg);
    } catch (err) {
      onError(err, 'log channel');
    }
  }

  /** A transcript is the only copy outside the database: try 3 times before giving up. */
  async function logTranscript(msg: LogMessage): Promise<void> {
    let last: unknown;
    for (let attempt = 1; attempt <= LOG_ATTEMPTS; attempt++) {
      try {
        await discord.sendLog(msg);
        return;
      } catch (err) {
        last = err;
        if (attempt < LOG_ATTEMPTS) await sleep(attempt * 1000);
      }
    }
    onError(last, 'log transcript');
  }

  /** Stores a failed DM for the «Ошибки доставки» list. Never throws. */
  async function reportDelivery(userId: string, what: string, err: unknown): Promise<void> {
    try {
      await api.reportDelivery(userId, what, codeOf(err));
    } catch (reportErr) {
      onError(reportErr, 'report delivery');
    }
  }

  /**
   * The only way to DM a person. A failed DM is stored through the API; a closed DM (50007) is also
   * written to the log and gives `null`; every other error is thrown to the caller.
   */
  async function dm(userId: string, msg: OutMessage, what: string): Promise<MsgRef | null> {
    try {
      return await discord.sendDm(userId, msg);
    } catch (err) {
      await reportDelivery(userId, what, err);
      if (!isDmClosed(err)) throw err;
      await log(`Не удалось доставить ЛС ${who(userId)} (${what}): личные сообщения закрыты.`);
      return null;
    }
  }

  /** A DM that may fail without breaking the flow: the failure is reported and swallowed. */
  async function tell(userId: string, text: string, what: string): Promise<void> {
    try {
      await dm(userId, { text }, what);
    } catch (err) {
      onError(err, 'dm');
    }
  }

  async function editOffers(ticketId: string, text: string, except?: string): Promise<void> {
    let offers: Awaited<ReturnType<OfferStore['offers']>>;
    try {
      offers = await store.offers(ticketId);
    } catch (err) {
      onError(err, 'read offers');
      return;
    }
    for (const other of offers) {
      if (other.userId === except) continue;
      try {
        await discord.edit(other.ref, { text });
      } catch (err) {
        onError(err, 'edit offer');
      }
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

  /**
   * DMs the task to each support. A failure for one support (closed DMs, Redis down) never stops
   * the others; Discord error 40003 does, because every further DM would fail the same way, and is
   * thrown to the caller so it can back the whole batch off.
   */
  async function offer(ticketId: string, challenges: Offered, reoffer = false): Promise<void> {
    if (challenges.length === 0) return;
    const delivered: string[] = [];
    for (const { supportDiscordId, challenge } of challenges) {
      const msg: OutMessage = {
        text: `Новый тикет #${shortId(ticketId)}. Выберите: ${ITEM_RU[challenge.target as ItemKey] ?? challenge.target}`,
        images: challenge.options,
        buttons: challenge.options.map((_, i) => ({ id: claimId(ticketId, i), label: String(i + 1) })),
      };
      try {
        const ref = await dm(supportDiscordId, msg, `тикет #${shortId(ticketId)}`);
        if (ref) {
          delivered.push(who(supportDiscordId));
          try {
            await store.addOffer(ticketId, supportDiscordId, ref);
          } catch (err) {
            onError(err, 'store offer');
          }
        }
      } catch (err) {
        if (isDmTooFast(err)) throw err;
        onError(err, 'offer');
        await log(`Не удалось отправить предложение тикета #${shortId(ticketId)} ${who(supportDiscordId)}.`);
      }
    }
    await log(
      `Тикет #${shortId(ticketId)} ${reoffer ? 'предложен повторно' : 'предложен'}: ${delivered.join(', ') || 'никому не доставлен'}.`,
    );
  }

  async function handleHelpSubmit(ix: Replier & { userId: string; username: string; text: string }): Promise<void> {
    rememberName(ix.userId, ix.username);
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
    await log(`Создан тикет #${n} от ${who(ix.userId)}: ${question}`);
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
              : 'Скоро к вам подключится сотрудник поддержки. Переписка идёт здесь, в личных сообщениях.') +
            '\nПока тикет никто не принял, его можно отменить кнопкой ниже.',
          buttons: [{ id: cancelId(created.ticketId), label: 'Отменить' }],
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
    try {
      await offer(created.ticketId, created.challenges);
    } catch (err) {
      // The scheduler offers the ticket again in 5 minutes.
      onError(err, 'offer');
    }
  }

  // ---------- claim ----------

  const claimedView = (ticketId: string, description: string | undefined): OutMessage => ({
    text: `Вы приняли тикет #${shortId(ticketId)}.\n\nВопрос:\n${description ?? '(текст вопроса недоступен)'}\n\nПишите ответ сюда, я передам его пользователю.`,
    buttons: [{ id: closeId(ticketId), label: 'Закрыть тикет' }],
  });

  async function handleClaim(ix: ButtonCtx & { ticketId: string; index: number }): Promise<void> {
    rememberName(ix.userId, ix.username);
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
      await log(`Неверный ответ на проверку тикета #${n}: ${who(ix.userId)}.`);
    } else if (r.result === 'already_taken') {
      await ix.update({ text: 'Тикет уже принят.' });
    } else if (r.result === 'closed') {
      await ix.update({ text: 'Тикет уже закрыт.' });
    } else if (r.result === 'busy') {
      // The attempt is not spent: the buttons stay, the support can answer after closing.
      await ix.notify('Сначала закройте текущий тикет.');
    } else if (r.result === 'yours') {
      // A second press on a ticket they already hold: show it again, with the Close button.
      await ix.update(claimedView(ix.ticketId, r.description));
    } else {
      await ix.update(claimedView(ix.ticketId, r.description));
      if (r.requesterDiscordId) {
        await tell(
          r.requesterDiscordId,
          `К вашему тикету #${n} подключился сотрудник поддержки. Пишите сюда, он ответит.`,
          `тикет #${n}`,
        );
      }
      await log(`Тикет #${n} принят: ${who(ix.userId)}.`);
      await editOffers(ix.ticketId, 'Тикет уже принят.', ix.userId);
    }
  }

  // ---------- cancel ----------

  async function handleCancel(ix: ButtonCtx & { ticketId: string }): Promise<void> {
    rememberName(ix.userId, ix.username);
    const n = shortId(ix.ticketId);
    let r;
    try {
      r = await api.cancel(ix.ticketId, ix.userId);
    } catch (err) {
      onError(err, 'cancel');
      await ix.notify('Не удалось отменить тикет.');
      return;
    }
    if (r.result === 'cancelled') {
      await ix.update({ text: `Тикет #${n} отменён. Если вопрос остался, создайте новый через /help.` });
      await editOffers(ix.ticketId, 'Тикет отменён.');
      await log(`Тикет #${n} отменён пользователем ${who(ix.userId)}.`);
    } else if (r.result === 'claimed') {
      await ix.update({ text: `Тикет #${n} уже принят сотрудником, отменить его нельзя. Пишите сюда, он ответит.` });
    } else {
      await ix.update({ text: `Тикет #${n} уже закрыт.` });
    }
  }

  // ---------- relay ----------

  /** The lines for the attachments: `relay` for the other side, `stored` for the transcript. */
  async function attachmentLines(
    files: Attachment[],
    ticketId: string,
    authorId: string,
  ): Promise<{ relay: string[]; stored: string[] }> {
    const relay: string[] = [];
    const stored: string[] = [];
    for (const f of files) {
      relay.push(`Вложение: ${f.url}`);
      if (f.size > ARCHIVE_MAX_BYTES) {
        stored.push(`Вложение: ${f.name} — больше 25 МБ, в логе нет копии: ${f.url}`);
        continue;
      }
      try {
        const copy = await discord.archiveFile(
          { url: f.url, name: f.name },
          `Вложение к тикету #${shortId(ticketId)} от ${who(authorId)}`,
        );
        stored.push(`Вложение: ${f.name} — ${copy}`);
      } catch (err) {
        onError(err, 'archive attachment');
        stored.push(`Вложение: ${f.name} — копия в логе не сохранилась: ${f.url}`);
      }
    }
    return { relay, stored };
  }

  /** A DM written to the bot. Ignores bots. */
  async function handleDm(ix: {
    authorId: string;
    username?: string;
    isBot: boolean;
    content: string;
    attachments: Attachment[];
    messageId: string;
    reply(text: string): Promise<void>;
  }): Promise<void> {
    if (ix.isBot) return;
    rememberName(ix.authorId, ix.username);
    const body = ix.content.trim();
    if (!body && ix.attachments.length === 0) {
      await ix.reply('В сообщении нет ни текста, ни файла, передавать нечего. Напишите текст или приложите файл.');
      return;
    }
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
    const files = await attachmentLines(ix.attachments, active.ticketId, ix.authorId);
    const relayText = [body, ...files.relay].filter(Boolean).join('\n').slice(0, MAX_RELAY);
    const storedText = [body, ...files.stored].filter(Boolean).join('\n').slice(0, MAX_RELAY);
    let saved;
    try {
      saved = await api.addMessage(active.ticketId, ix.authorId, storedText, ix.messageId);
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
    const out = saved.isStaff ? `Поддержка: ${relayText}` : `Пользователь: ${relayText}`;
    let sent: MsgRef | null = null;
    try {
      sent = await dm(saved.recipientDiscordId, { text: out }, `сообщение по тикету #${shortId(active.ticketId)}`);
    } catch (err) {
      onError(err, 'relay');
    }
    if (!sent) await ix.reply('Сообщение сохранено, но доставить его не удалось.');
  }

  // ---------- close, release and rating ----------

  /** After a close by a person: asks the requester for a rating and writes the transcript to the log. */
  async function afterClose(
    ticketId: string,
    r: { requesterDiscordId: string; transcript: string; messageCount: number },
    closerId: string,
  ): Promise<void> {
    const n = shortId(ticketId);
    try {
      await dm(
        r.requesterDiscordId,
        {
          text: `Тикет #${n} закрыт. Оцените помощь поддержки от 1 до 5.`,
          buttons: [1, 2, 3, 4, 5].map((v) => ({ id: rateId(ticketId, v), label: String(v) })),
        },
        `закрытие тикета #${n}`,
      );
    } catch (err) {
      onError(err, 'dm requester');
    }
    await logTranscript({
      text: `Тикет #${n} закрыт. Закрыл: ${who(closerId)}.`,
      file: { name: `ticket-${n}.txt`, content: r.transcript },
      embed: {
        title: `Тикет #${n} закрыт`,
        fields: [
          { name: 'Пользователь', value: who(r.requesterDiscordId) },
          { name: 'Закрыл', value: who(closerId) },
          { name: 'Сообщений', value: String(r.messageCount) },
        ],
      },
    });
  }

  async function handleClose(ix: ButtonCtx & { ticketId: string }): Promise<void> {
    rememberName(ix.userId, ix.username);
    const n = shortId(ix.ticketId);
    let r;
    try {
      r = await api.close(ix.ticketId, ix.userId);
    } catch (err) {
      if (apiReason(err) === 'ticket_closed') {
        await ix.update({ text: `Тикет #${n} уже закрыт.` });
      } else if (err instanceof ApiError && err.code === 'FORBIDDEN') {
        await ix.notify('Вы больше не ведёте этот тикет.');
      } else {
        onError(err, 'close');
        await ix.notify('Не удалось закрыть тикет.');
      }
      return;
    }
    await ix.update({ text: `Тикет #${n} закрыт. Спасибо за работу!` });
    await afterClose(ix.ticketId, r, ix.userId);
  }

  /**
   * An admin closes a ticket from /menu. Gives the note for the menu. A refusal (the admin lost
   * the role) is thrown, so the menu can show "Нет доступа".
   */
  async function adminClose(ticketId: string, actorId: string, actorName?: string): Promise<string> {
    rememberName(actorId, actorName);
    const n = shortId(ticketId);
    let r;
    try {
      r = await api.close(ticketId, actorId);
    } catch (err) {
      if (apiReason(err) === 'ticket_closed') return `Тикет #${n} уже закрыт.`;
      throw err;
    }
    if (r.claimerDiscordId) await tell(r.claimerDiscordId, `Тикет #${n} закрыт администратором.`, `тикет #${n}`);
    await afterClose(ticketId, r, actorId);
    return `Тикет #${n} закрыт.`;
  }

  /** An admin returns a claimed ticket to the queue from /menu; the scheduler offers it again. */
  async function adminRelease(ticketId: string, actorId: string, actorName?: string): Promise<string> {
    rememberName(actorId, actorName);
    const n = shortId(ticketId);
    let r;
    try {
      r = await api.release(ticketId, actorId);
    } catch (err) {
      if (apiReason(err) === 'not_claimed') return `Тикет #${n} уже не в работе.`;
      throw err;
    }
    await tell(
      r.requesterDiscordId,
      `Тикет #${n} возвращён в очередь: его передали другому сотруднику. Ждите, скоро к вам подключатся.`,
      `тикет #${n}`,
    );
    if (r.claimerDiscordId) {
      await tell(r.claimerDiscordId, `Тикет #${n} передан другому сотруднику.`, `тикет #${n}`);
    }
    await log(
      `Тикет #${n} возвращён в очередь: ${who(actorId)}` +
        (r.claimerDiscordId ? ` (вёл ${who(r.claimerDiscordId)})` : '') +
        '.',
    );
    return `Тикет #${n} возвращён в очередь.`;
  }

  /** A ticket the API closed after 24 hours without activity: tells both sides, logs the transcript. */
  async function handleExpired(t: {
    ticketId: string;
    requesterDiscordId: string;
    claimerDiscordId: string | null;
    transcript: string;
    messageCount: number;
  }): Promise<void> {
    const n = shortId(t.ticketId);
    await tell(
      t.requesterDiscordId,
      `Тикет #${n} закрыт: в нём не было активности 24 часа. Если вопрос остался, создайте новый через /help.`,
      `закрытие тикета #${n}`,
    );
    if (t.claimerDiscordId) {
      await tell(
        t.claimerDiscordId,
        `Тикет #${n} закрыт автоматически: в нём не было активности 24 часа.`,
        `закрытие тикета #${n}`,
      );
    }
    await editOffers(t.ticketId, 'Тикет закрыт.');
    await logTranscript({
      text: `Тикет #${n} закрыт автоматически: нет активности 24 часа.`,
      file: { name: `ticket-${n}.txt`, content: t.transcript },
      embed: {
        title: `Тикет #${n} закрыт (24 часа без активности)`,
        fields: [
          { name: 'Пользователь', value: who(t.requesterDiscordId) },
          { name: 'Вёл', value: t.claimerDiscordId ? who(t.claimerDiscordId) : 'никто' },
          { name: 'Сообщений', value: String(t.messageCount) },
        ],
      },
    });
  }

  async function handleRating(ix: ButtonCtx & { ticketId: string; rating: number }): Promise<void> {
    rememberName(ix.userId, ix.username);
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
    await log(`Тикет #${n} оценён: ${ix.rating} из 5 (${who(ix.userId)}).`);
  }

  return {
    handleHelpCommand,
    handleHelpSubmit,
    handleClaim,
    handleCancel,
    handleDm,
    handleClose,
    handleRating,
    adminClose,
    adminRelease,
    handleExpired,
    offer,
    dm,
    log,
  };
}

export type Handlers = ReturnType<typeof createHandlers>;

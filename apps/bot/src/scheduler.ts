import type { ServerConfig } from '@crystalaid/config';
import type { ApiClient } from './api.js';
import { isDmTooFast, type Handlers } from './handlers.js';

export const TICK_MS = 30_000;
/** The same failure is written to the log channel at most this often. */
const LOG_EVERY_MS = 10 * 60_000;
/** After Discord error 40003 (opening DMs too fast) no offers go out for this long. */
export const OFFER_BACKOFF_MS = 10 * 60_000;

export interface SchedulerDeps {
  api: Pick<ApiClient, 'reminders' | 'due' | 'expire' | 'confirmReminder'>;
  handlers: Pick<Handlers, 'dm' | 'offer' | 'log' | 'handleExpired'>;
  config: Pick<ServerConfig, 'timezone'>;
  now?: () => number;
  onError?: (err: unknown, where: string) => void;
}

/** "14:00" in the configured timezone. */
function clock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(
    date,
  );
}

/** "3 минуты": the Russian plural of a number of minutes after "через". */
function minutes(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return `${n} минуту`;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return `${n} минуты`;
  return `${n} минут`;
}

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;
  const onError = deps.onError ?? ((err, where) => console.error(`[bot] ${where}:`, err));
  const lastLogged = new Map<string, number>();
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let offersPausedUntil = 0;

  async function fail(where: string, err: unknown): Promise<void> {
    onError(err, where);
    const at = lastLogged.get(where) ?? -Infinity;
    if (now() - at < LOG_EVERY_MS) return;
    lastLogged.set(where, now());
    const reason = err instanceof Error ? err.message.slice(0, 200) : 'неизвестная ошибка';
    await deps.handlers.log(`Ошибка планировщика (${where}): ${reason}`);
  }

  /**
   * A reminder is confirmed to the API only after the DM went out (or the person's DMs are closed,
   * which retrying cannot fix). A failed send stays unconfirmed, so the next pass, or a restarted
   * bot, sends it again while the slot is still within its window.
   */
  async function reminders(): Promise<void> {
    const { items } = await deps.api.reminders();
    for (const slot of items) {
      const start = new Date(slot.startsAt);
      const end = new Date(start.getTime() + 3_600_000);
      const left = Math.ceil((start.getTime() - now()) / 60_000);
      const span = `${clock(start, deps.config.timezone)}–${clock(end, deps.config.timezone)}`;
      const text = left >= 1 ? `Через ${minutes(left)} ваш ПТ: ${span}` : `Ваш ПТ начинается сейчас: ${span}`;
      try {
        await deps.handlers.dm(slot.discordId, { text }, 'напоминание о ПТ');
        await deps.api.confirmReminder(slot.slotId);
      } catch (err) {
        await fail('reminder', err);
      }
    }
  }

  async function due(): Promise<void> {
    if (now() < offersPausedUntil) return;
    const { items } = await deps.api.due();
    for (const t of items) {
      try {
        await deps.handlers.offer(t.ticketId, t.challenges, t.reoffer);
      } catch (err) {
        if (isDmTooFast(err)) {
          // Every further DM would fail the same way: the whole batch waits. The tickets are marked
          // as offered, so they come back by the normal re-offer with the same tasks.
          offersPausedUntil = now() + OFFER_BACKOFF_MS;
          await fail('offer (Discord 40003: слишком частые личные сообщения, пауза 10 минут)', err);
          return;
        }
        await fail('offer', err);
      }
    }
  }

  /** Tickets idle for 24 hours were closed by the API; the bot tells both sides and logs them. */
  async function expire(): Promise<void> {
    const { items } = await deps.api.expire();
    for (const t of items) {
      try {
        await deps.handlers.handleExpired(t);
      } catch (err) {
        await fail('expired ticket', err);
      }
    }
  }

  /** One pass. Never throws. */
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const [name, job] of [
        ['reminders', reminders],
        ['due tickets', due],
        ['expire tickets', expire],
      ] as const) {
        try {
          await job();
        } catch (err) {
          await fail(name, err);
        }
      }
    } catch (err) {
      onError(err, 'scheduler');
    } finally {
      running = false;
    }
  }

  function start(): void {
    const loop = (): void => {
      if (stopped) return;
      timer = setTimeout(() => void tick().finally(loop), TICK_MS);
    };
    loop();
  }

  function stop(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
  }

  return { tick, start, stop };
}

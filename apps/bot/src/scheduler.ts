import type { ServerConfig } from '@crystalaid/config';
import type { ApiClient } from './api.js';
import type { Handlers } from './handlers.js';

export const TICK_MS = 30_000;
/** The same failure is written to the log channel at most this often. */
const LOG_EVERY_MS = 10 * 60_000;

export interface SchedulerDeps {
  api: Pick<ApiClient, 'reminders' | 'due'>;
  handlers: Pick<Handlers, 'dm' | 'offer' | 'log'>;
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

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;
  const onError = deps.onError ?? ((err, where) => console.error(`[bot] ${where}:`, err));
  const lastLogged = new Map<string, number>();
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function fail(where: string, err: unknown): Promise<void> {
    onError(err, where);
    const at = lastLogged.get(where) ?? -Infinity;
    if (now() - at < LOG_EVERY_MS) return;
    lastLogged.set(where, now());
    const reason = err instanceof Error ? err.message.slice(0, 200) : 'неизвестная ошибка';
    await deps.handlers.log(`Ошибка планировщика (${where}): ${reason}`);
  }

  async function reminders(): Promise<void> {
    const { items } = await deps.api.reminders();
    for (const slot of items) {
      const start = new Date(slot.startsAt);
      const end = new Date(start.getTime() + 3_600_000);
      try {
        await deps.handlers.dm(
          slot.discordId,
          { text: `Через 5 минут ваш ПТ: ${clock(start, deps.config.timezone)}–${clock(end, deps.config.timezone)}` },
          'напоминание о ПТ',
        );
      } catch (err) {
        await fail('reminder', err);
      }
    }
  }

  async function due(): Promise<void> {
    const { items } = await deps.api.due();
    for (const t of items) {
      try {
        await deps.handlers.offer(t.ticketId, t.description, t.challenges, t.reoffer);
      } catch (err) {
        await fail('offer', err);
      }
    }
  }

  /** One pass. Never throws. */
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const [name, job] of [['reminders', reminders], ['due tickets', due]] as const) {
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

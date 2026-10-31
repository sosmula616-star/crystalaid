const DAY_MS = 24 * 60 * 60 * 1000;

interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock time of an instant, expressed as if it were UTC. */
function wallAsUtc(ms: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

function offsetMs(ms: number, timeZone: string): number {
  return wallAsUtc(Math.floor(ms / 1000) * 1000, timeZone) - Math.floor(ms / 1000) * 1000;
}

/** Instant at which the local clock in `timeZone` reads 00:00 on the given date. */
function localMidnight({ year, month, day }: Wall, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}

/** Week is Monday 00:00 (inclusive) to next Monday 00:00 (exclusive) in the given time zone. */
export function weekBounds(at: Date, timeZone: string): { start: Date; end: Date } {
  const local = new Date(wallAsUtc(at.getTime(), timeZone));
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - sinceMonday * DAY_MS);
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
  const toWall = (d: Date): Wall => ({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });
  return {
    start: new Date(localMidnight(toWall(monday), timeZone)),
    end: new Date(localMidnight(toWall(nextMonday), timeZone)),
  };
}

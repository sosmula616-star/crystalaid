const HOUR_MS = 3_600_000;
const partsFormat = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormat.set(timeZone, f);
  }
  return f;
}

function wallParts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

/** Milliseconds the zone is ahead of UTC at `date` (whole seconds). */
function offsetMs(date: Date, timeZone: string): number {
  const p = wallParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` shows the given time. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let result = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(result), timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** Start of the clock hour (in `timeZone`) that contains `date`. */
export function hourStart(date: Date, timeZone: string): Date {
  const off = offsetMs(date, timeZone);
  const local = date.getTime() + off;
  const floored = local - (((local % HOUR_MS) + HOUR_MS) % HOUR_MS);
  return new Date(floored - offsetMs(new Date(floored - off), timeZone));
}

/** `YYYY-MM-DD` of `date` on the wall clock of `timeZone`. */
export function localDay(date: Date, timeZone: string): string {
  const p = wallParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:mm:ss` of `date` on the wall clock of `timeZone`. */
export function formatInZone(date: Date, timeZone: string): string {
  const p = wallParts(date, timeZone);
  const t = (n: number) => String(n).padStart(2, '0');
  return `${localDay(date, timeZone)} ${t(p.hour)}:${t(p.minute)}:${t(p.second)}`;
}

/** The instants [start, end) of the local day `YYYY-MM-DD` in `timeZone`. */
export function dayBounds(day: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: zonedToUtc(y, m, d, 0, 0, timeZone),
    end: zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone),
  };
}

const fmt = new Map<string, Intl.DateTimeFormat>();

function parts(date: Date, timeZone: string): Record<string, number> {
  let f = fmt.get(timeZone);
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
    fmt.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

const offsetMs = (date: Date, tz: string): number => {
  const p = parts(date, tz);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(date.getTime() / 1000) * 1000;
};

/** The instant at which the wall clock of `tz` shows `date` (YYYY-MM-DD) at `hour`:00. */
export function zonedHour(date: string, hour: number, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, hour);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Today's date (YYYY-MM-DD) on the wall clock of `tz`. */
export function localDate(now: Date, tz: string): string {
  const p = parts(now, tz);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

/** The local hour (0 to 23) of an instant. */
export const localHour = (iso: string, tz: string): number => parts(new Date(iso), tz).hour!;

export function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** "05.11.2026" for a YYYY-MM-DD date. */
export const showDate = (date: string): string => date.split('-').reverse().join('.');

/** Accepts `ДД.ММ.ГГГГ`, `ДД.ММ` (this year) and `ГГГГ-ММ-ДД`. Gives YYYY-MM-DD or null for a date that does not exist. */
export function parseTypedDate(text: string, today: string): string | null {
  const t = text.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const ru = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/.exec(t);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (ru) [d, mo, y] = [Number(ru[1]), Number(ru[2]), ru[3] ? Number(ru[3]) : Number(today.slice(0, 4))];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2020 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

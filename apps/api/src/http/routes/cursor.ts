import { AppError } from '@crystalaid/contracts';

export const PAGE_SIZE = 50;

const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Cursor {
  /** The timestamp as Postgres prints it, so microseconds survive the round trip. */
  ts: string;
  id: string;
}

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify([c.ts, c.id])).toString('base64url');

/** Real calendar date and time, years 2000 to 2100, so Postgres never has to reject the value. */
function isSaneTimestamp(ts: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2})(?::(\d{2}))?$/.exec(ts);
  if (!m) return false;
  const iso = `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5] ?? '00'}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const year = Number(m[1]!.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  // JS normalises Feb 30 into March; compare the local date part to catch that.
  const local = new Date(`${m[1]}T${m[2]}Z`);
  return !Number.isNaN(local.getTime()) && local.toISOString().startsWith(m[1]!) && Number(m[4]) <= 15;
}

/** Opaque to clients; anything that does not decode to (timestamp, uuid) is a 400. */
export function decodeCursor(raw: string): Cursor {
  const bad = () => new AppError('VALIDATION_ERROR', 'Invalid cursor', 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw bad();
  const [ts, id] = parsed as unknown[];
  if (typeof ts !== 'string' || typeof id !== 'string' || !TS.test(ts) || !UUID.test(id)) throw bad();
  if (!isSaneTimestamp(ts)) throw bad();
  return { ts, id };
}

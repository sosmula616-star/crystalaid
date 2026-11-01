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
  return { ts, id };
}

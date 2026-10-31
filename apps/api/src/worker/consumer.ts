import type { Redis } from 'ioredis';
import type { ServerConfig } from '@crystalaid/config';
import { BotEvent } from '@crystalaid/contracts';
import type { Db } from '@crystalaid/database';
import type { Logger } from '../log.js';
import { applySnapshot, removeMember, syncMember } from '../services/staff.js';

export const STREAM = 'events:bot';
export const GROUP = 'workers';
export const DEAD_STREAM = 'events:dead';

const BATCH_SIZE = 50;
const DEFAULT_MIN_IDLE_MS = 60_000;
const DEFAULT_BLOCK_MS = 1000;

export interface ConsumerDeps {
  db: Db;
  redis: Redis;
  config: ServerConfig;
  log: Logger;
  /** How long an entry must stay pending before another consumer may claim it. */
  minIdleMs?: number;
  /** How long to wait for new entries; 0 does not block. */
  blockMs?: number;
}

type Entry = [id: string, fields: string[]];
type ReadReply = [stream: string, entries: Entry[]][] | null;

async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

/** Entries pending longer than minIdleMs (a crashed or failed consumer) become ours. */
async function reclaim(redis: Redis, consumer: string, minIdleMs: number): Promise<Entry[]> {
  const pending = (await redis.xpending(STREAM, GROUP, '-', '+', BATCH_SIZE)) as [
    string,
    string,
    number,
    number,
  ][];
  const stale = pending.filter(([, , idle]) => idle >= minIdleMs).map(([id]) => id);
  if (stale.length === 0) return [];
  const claimed = (await redis.xclaim(STREAM, GROUP, consumer, minIdleMs, ...stale)) as (Entry | null)[];
  const entries = claimed.filter((e): e is Entry => Array.isArray(e));
  // An entry trimmed from the stream while pending comes back empty; drop it from the list.
  const returned = new Set(entries.map(([id]) => id));
  const gone = stale.filter((id) => !returned.has(id));
  if (gone.length > 0) await redis.xack(STREAM, GROUP, ...gone);
  return entries;
}

function fieldValue(fields: string[], name: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}

async function deadLetter(redis: Redis, id: string, raw: string | undefined, error: string): Promise<void> {
  await redis.xadd(DEAD_STREAM, '*', 'id', id, 'event', raw ?? '', 'error', error);
}

/**
 * Reads one batch (reclaimed entries first), handles each event and acknowledges it after
 * success. Unparsable or invalid events go to `events:dead` and are acknowledged. A handler
 * error leaves the entry pending so it is retried after minIdleMs. Returns acknowledged count.
 */
export async function consumeBatch(deps: ConsumerDeps, consumer: string): Promise<number> {
  const { db, redis, config, log } = deps;
  await ensureGroup(redis);

  const entries = await reclaim(redis, consumer, deps.minIdleMs ?? DEFAULT_MIN_IDLE_MS);
  const blockMs = entries.length > 0 ? 0 : (deps.blockMs ?? DEFAULT_BLOCK_MS);
  const read = (await (blockMs > 0
    ? redis.xreadgroup('GROUP', GROUP, consumer, 'COUNT', BATCH_SIZE, 'BLOCK', blockMs, 'STREAMS', STREAM, '>')
    : redis.xreadgroup('GROUP', GROUP, consumer, 'COUNT', BATCH_SIZE, 'STREAMS', STREAM, '>'))) as ReadReply;
  for (const [, fresh] of read ?? []) entries.push(...fresh);

  let acked = 0;
  for (const [id, fields] of entries) {
    const raw = fieldValue(fields, 'event');
    let json: unknown;
    try {
      json = JSON.parse(raw ?? '');
    } catch {
      log.warn('event is not valid JSON, moved to dead stream', { id });
      await deadLetter(redis, id, raw, 'invalid JSON');
      await redis.xack(STREAM, GROUP, id);
      acked += 1;
      continue;
    }
    const parsed = BotEvent.safeParse(json);
    if (!parsed.success) {
      log.warn('event failed schema validation, moved to dead stream', { id });
      await deadLetter(redis, id, raw, 'schema validation failed');
      await redis.xack(STREAM, GROUP, id);
      acked += 1;
      continue;
    }
    const event = parsed.data;
    try {
      if (event.guildId !== config.guildId) {
        log.info('event for another guild ignored', { id, type: event.type });
      } else if (event.type === 'member.updated') {
        await syncMember({ db, config }, { ...event, at: new Date(event.at) });
      } else if (event.type === 'member.removed') {
        await removeMember({ db, config }, event.userId, new Date(event.at));
      } else {
        await applySnapshot({ db, redis, config, log }, event);
      }
      await redis.xack(STREAM, GROUP, id);
      acked += 1;
    } catch (err) {
      log.error('event handling failed, left pending for retry', {
        id,
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return acked;
}

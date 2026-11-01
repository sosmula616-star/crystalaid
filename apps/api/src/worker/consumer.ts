import { sql } from 'drizzle-orm';
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
const PENDING_PAGE = 50;
const DEFAULT_MIN_IDLE_MS = 60_000;
const DEFAULT_BLOCK_MS = 1000;
/** An entry delivered more than this many times is moved to the dead stream. */
export const MAX_DELIVERIES = 5;

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
type PendingRow = [id: string, consumer: string, idleMs: number, deliveries: number];

async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

/** Stream id just after `id`. Redis 5 has no exclusive range, so the sequence is incremented. */
function nextId(id: string): string {
  const [ms, seq] = id.split('-');
  return `${ms}-${BigInt(seq ?? '0') + 1n}`;
}

/** Every pending entry, paged by cursor so that old entries do not hide newer ones. */
async function allPending(redis: Redis): Promise<PendingRow[]> {
  const rows: PendingRow[] = [];
  let start = '-';
  for (;;) {
    const page = (await redis.xpending(STREAM, GROUP, start, '+', PENDING_PAGE)) as PendingRow[];
    rows.push(...page);
    const last = page[page.length - 1];
    if (!last || page.length < PENDING_PAGE) return rows;
    start = nextId(last[0]);
  }
}

async function entryById(redis: Redis, id: string): Promise<Entry | undefined> {
  const found = (await redis.xrange(STREAM, id, id)) as Entry[];
  return found[0];
}

async function deadLetter(redis: Redis, id: string, raw: string | undefined, error: string): Promise<void> {
  await redis.xadd(DEAD_STREAM, '*', 'id', id, 'event', raw ?? '', 'error', error);
}

function fieldValue(fields: string[], name: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}

/**
 * Takes over entries pending longer than minIdleMs. Entries already delivered too many times go
 * to the dead stream instead. An entry XCLAIM did not return is acknowledged only if XRANGE
 * shows it no longer exists; otherwise another consumer holds it and it is left alone.
 */
async function reclaim(deps: ConsumerDeps, consumer: string, minIdleMs: number): Promise<Entry[]> {
  const { redis, log } = deps;
  const stale = (await allPending(redis)).filter(([, , idle]) => idle >= minIdleMs);

  const claimable: string[] = [];
  for (const [id, , , deliveries] of stale) {
    if (deliveries > MAX_DELIVERIES) {
      const entry = await entryById(redis, id);
      if (entry) {
        log.error('event exceeded the delivery limit, moved to dead stream', { id, deliveries });
        await deadLetter(
          redis,
          id,
          fieldValue(entry[1], 'event'),
          `delivery limit exceeded: delivered ${deliveries} times without success`,
        );
      }
      await redis.xack(STREAM, GROUP, id);
    } else if (claimable.length < BATCH_SIZE) {
      claimable.push(id);
    }
  }
  if (claimable.length === 0) return [];

  const claimed = (await redis.xclaim(STREAM, GROUP, consumer, minIdleMs, ...claimable)) as (Entry | null)[];
  const entries = claimed.filter((e): e is Entry => Array.isArray(e));
  const returned = new Set(entries.map(([id]) => id));
  for (const id of claimable) {
    if (returned.has(id)) continue;
    if (!(await entryById(redis, id))) await redis.xack(STREAM, GROUP, id);
  }
  return entries;
}

/**
 * Reads one batch (reclaimed entries first), handles each event and acknowledges it after
 * success. Unparsable or invalid events go to `events:dead` and are acknowledged. A handler
 * error leaves the entry pending so it is retried after minIdleMs. Returns acknowledged count.
 */
export async function consumeBatch(deps: ConsumerDeps, consumer: string): Promise<number> {
  const { db, redis, config, log } = deps;
  // An outage must not spend delivery counts: fail before any reclaim or delivery.
  await db.execute(sql`select 1`);
  await ensureGroup(redis);

  const entries = await reclaim(deps, consumer, deps.minIdleMs ?? DEFAULT_MIN_IDLE_MS);
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

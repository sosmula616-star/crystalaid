import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '@crystalaid/config';
import type { BotEvent } from '@crystalaid/contracts';

export interface RosterMember {
  userId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
}

export interface EventSink {
  publish(event: BotEvent): Promise<void>;
}

type RosterConfig = Pick<ServerConfig, 'guildId' | 'roles' | 'users'>;

/**
 * Where a snapshot reads members from. `fetchAll` gets a filter and returns only the members that
 * pass it, so 300,000 members are never turned into rows; `fetchByIds` fetches the listed users.
 */
export interface SnapshotSource {
  fetchAll(keep: (roleIds: string[]) => boolean): Promise<RosterMember[]>;
  fetchByIds(ids: string[]): Promise<RosterMember[]>;
}

/**
 * Decides which members the API hears about: branch role holders now or before, and the people
 * listed in `users.admins` and `users.developers`. "Before" is remembered in `known`, because the
 * member cache is small and the old state of a member is usually not available.
 */
export function createRoster(cfg: RosterConfig, sink: EventSink, now: () => Date = () => new Date()) {
  const branchRoles = new Set([...cfg.roles.support, ...cfg.roles.curator, ...cfg.roles.admin]);
  const listed = new Set([...cfg.users.admins, ...cfg.users.developers]);
  const known = new Set<string>();

  const holdsBranchRole = (roleIds: Iterable<string>): boolean => {
    for (const r of roleIds) if (branchRoles.has(r)) return true;
    return false;
  };
  const isRelevant = (userId: string, roleIds: Iterable<string>): boolean =>
    listed.has(userId) || holdsBranchRole(roleIds);

  async function memberUpdated(m: RosterMember): Promise<void> {
    const nowRelevant = isRelevant(m.userId, m.roleIds);
    if (!nowRelevant && !known.has(m.userId)) return;
    await sink.publish({
      type: 'member.updated',
      guildId: cfg.guildId,
      userId: m.userId,
      username: m.username,
      avatar: m.avatar,
      roleIds: m.roleIds,
      at: now().toISOString(),
    });
    if (nowRelevant) known.add(m.userId);
    else known.delete(m.userId);
  }

  async function memberRemoved(userId: string, roleIds: Iterable<string> = []): Promise<void> {
    if (!known.has(userId) && !isRelevant(userId, roleIds)) return;
    await sink.publish({ type: 'member.removed', guildId: cfg.guildId, userId, at: now().toISOString() });
    known.delete(userId);
  }

  /**
   * One snapshot of everyone relevant. `at` is taken before the fetch starts, so events that arrive
   * during a long fetch are newer than the snapshot. Listed users are fetched by id, not by scanning.
   */
  async function snapshot(source: SnapshotSource): Promise<number> {
    const at = now().toISOString();
    const all = await source.fetchAll(holdsBranchRole);
    const byId = new Map<string, RosterMember>();
    for (const m of all) if (holdsBranchRole(m.roleIds)) byId.set(m.userId, m);
    const missing = [...listed].filter((id) => !byId.has(id));
    if (missing.length > 0) for (const m of await source.fetchByIds(missing)) byId.set(m.userId, m);
    const members = [...byId.values()];
    await sink.publish({
      type: 'member.snapshot',
      guildId: cfg.guildId,
      snapshotId: randomUUID(),
      members,
      part: 1,
      parts: 1,
      at,
    });
    for (const m of members) known.add(m.userId);
    return members.length;
  }

  return { memberUpdated, memberRemoved, snapshot, isRelevant, known };
}

export type Roster = ReturnType<typeof createRoster>;

export interface RetryOptions {
  /** Attempts in all, the first included. */
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called for every failed attempt, also the last. */
  onFail?: (err: unknown, attempt: number) => void;
}

/** How long Discord asks to wait, in milliseconds (`retry_after` is in seconds). */
export function retryAfterMs(err: unknown): number {
  const e = err as { data?: { retry_after?: unknown }; retry_after?: unknown; timeToReset?: unknown } | null;
  const seconds = e?.data?.retry_after ?? e?.retry_after;
  if (typeof seconds === 'number' && seconds > 0) return Math.ceil(seconds * 1000);
  const ms = e?.timeToReset;
  return typeof ms === 'number' && ms > 0 ? Math.ceil(ms) : 0;
}

/**
 * A snapshot with retries: the gateway limits member requests, and one failure at startup would
 * leave the API without the roster. Waits `base * 2^n` (up to `maxMs`) and never less than Discord's
 * `retry_after`. Every failure goes to `onFail`; the last error is thrown. `known` is not touched by
 * a failed attempt, so removals and role losses are still reported meanwhile.
 */
export async function snapshotWithRetry(
  roster: { snapshot(source: SnapshotSource): Promise<number> },
  source: SnapshotSource,
  opts: RetryOptions = {},
): Promise<number> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 5_000;
  const maxMs = opts.maxMs ?? 5 * 60_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await roster.snapshot(source);
    } catch (err) {
      opts.onFail?.(err, attempt);
      if (attempt >= attempts) throw err;
      await sleep(Math.max(retryAfterMs(err), Math.min(baseMs * 2 ** (attempt - 1), maxMs)));
    }
  }
}

export interface SnapshotRunnerDeps {
  run(): Promise<number>;
  onDone?(members: number, reason: string): void;
  onFail?(err: unknown, reason: string): void;
  dailyMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/**
 * Runs snapshots one at a time. A trigger that arrives while one is running makes exactly one more
 * run after it (the roster may have changed meanwhile). `start` repeats the snapshot daily, which
 * repairs whatever the events missed.
 */
export function createSnapshotRunner(deps: SnapshotRunnerDeps) {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let running = false;
  let pending: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function go(reason: string): Promise<void> {
    running = true;
    try {
      const members = await deps.run();
      deps.onDone?.(members, reason);
    } catch (err) {
      deps.onFail?.(err, reason);
    } finally {
      running = false;
    }
    if (pending !== null) {
      const next = pending;
      pending = null;
      await go(next);
    }
  }

  function trigger(reason: string): void {
    if (running) {
      pending = reason;
      return;
    }
    void go(reason);
  }

  function start(): void {
    if (timer) return;
    timer = setIntervalFn(() => trigger('daily'), deps.dailyMs ?? 24 * 60 * 60_000);
    timer.unref?.();
  }

  function stop(): void {
    if (timer) clearIntervalFn(timer);
    timer = undefined;
  }

  return { trigger, start, stop };
}
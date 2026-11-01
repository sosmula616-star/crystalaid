import { describe, expect, it } from 'vitest';
import type { BotEvent } from '@crystalaid/contracts';
import { BotEvent as BotEventSchema } from '@crystalaid/contracts';
import { createRoster, createSnapshotRunner, snapshotWithRetry, type RosterMember } from './roster.js';
import { CFG, id } from './testing/kit.js';

const SUPPORT = CFG.roles.support[0]!;
const member = (n: number, roleIds: string[] = []): RosterMember => ({
  userId: id(n),
  username: `u${n}`,
  avatar: null,
  roleIds,
});

function setup() {
  const events: BotEvent[] = [];
  const times = ['2026-11-02T10:00:00.000Z', '2026-11-02T10:05:00.000Z', '2026-11-02T10:10:00.000Z'];
  let t = 0;
  const roster = createRoster(
    CFG,
    { publish: async (e) => void events.push(BotEventSchema.parse(e)) },
    () => new Date(times[Math.min(t++, times.length - 1)]!),
  );
  return { roster, events };
}

describe('roster events', () => {
  it('ignores people without branch roles', async () => {
    const { roster, events } = setup();
    await roster.memberUpdated(member(70, [id(500)]));
    await roster.memberRemoved(id(70), [id(500)]);
    expect(events).toEqual([]);
  });

  it('publishes for role holders, and once more when the role is lost, then stops', async () => {
    const { roster, events } = setup();
    await roster.memberUpdated(member(70, [SUPPORT]));
    await roster.memberUpdated(member(70, [])); // lost the role: the API must hear it
    await roster.memberUpdated(member(70, []));
    expect(events.map((e) => e.type)).toEqual(['member.updated', 'member.updated']);
    expect((events[1] as { roleIds: string[] }).roleIds).toEqual([]);
  });

  it('publishes for listed users whatever their roles', async () => {
    const { roster, events } = setup();
    await roster.memberUpdated(member(20, []));
    await roster.memberUpdated(member(21, [id(500)]));
    expect(events).toHaveLength(2);
  });

  it('publishes removal for holders and listed users only', async () => {
    const { roster, events } = setup();
    await roster.memberRemoved(id(70), [SUPPORT]);
    await roster.memberRemoved(id(20));
    await roster.memberRemoved(id(71));
    expect(events.map((e) => e.type)).toEqual(['member.removed', 'member.removed']);
  });

  it('remembers a member that was a holder before the cache dropped them', async () => {
    const { roster, events } = setup();
    await roster.snapshot({ fetchAll: async () => [member(70, [SUPPORT])], fetchByIds: async () => [] });
    events.length = 0;
    await roster.memberRemoved(id(70), []);
    expect(events.map((e) => e.type)).toEqual(['member.removed']);
  });
});

describe('snapshot', () => {
  it('is one part, takes `at` before the fetch, filters holders and fetches listed users by id', async () => {
    const { roster, events } = setup();
    let fetchedIds: string[] = [];
    const n = await roster.snapshot({
      fetchAll: async () => [member(70, [SUPPORT]), member(71, [id(500)]), member(72, [])],
      fetchByIds: async (ids) => {
        fetchedIds = ids;
        return [member(20, [])]; // the developer id 21 is not on the server
      },
    });
    expect(n).toBe(2);
    const snap = events[0] as Extract<BotEvent, { type: 'member.snapshot' }>;
    expect(snap).toMatchObject({ part: 1, parts: 1, at: '2026-11-02T10:00:00.000Z' });
    expect(snap.members.map((m) => m.userId).sort()).toEqual([id(20), id(70)]);
    expect(fetchedIds.sort()).toEqual([id(20), id(21)]);
    expect(events).toHaveLength(1);
  });

  it('does not fetch by id a listed user who already holds a branch role', async () => {
    const { roster } = setup();
    let fetched: string[] | undefined;
    await roster.snapshot({
      fetchAll: async () => [member(20, [SUPPORT])],
      fetchByIds: async (ids) => ((fetched = ids), []),
    });
    expect(fetched).toEqual([id(21)]);
  });
});

describe('snapshot retries (I4)', () => {
  const rateLimited = (seconds: number) => Object.assign(new Error('rate limited'), { data: { retry_after: seconds } });

  it('waits at least retry_after, logs every failure and publishes once it works', async () => {
    const { roster, events } = setup();
    let tries = 0;
    const sleeps: number[] = [];
    const fails: number[] = [];
    const n = await snapshotWithRetry(
      roster,
      {
        fetchAll: async () => {
          if (++tries <= 2) throw rateLimited(20);
          return [member(70, [SUPPORT])];
        },
        fetchByIds: async () => [],
      },
      { baseMs: 1000, sleep: async (ms) => void sleeps.push(ms), onFail: (_e, attempt) => void fails.push(attempt) },
    );
    expect(n).toBe(1);
    expect(sleeps).toEqual([20_000, 20_000]);
    expect(fails).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['member.snapshot']);
  });

  it('backs off exponentially, gives up with the last error, and known stays usable', async () => {
    const { roster, events } = setup();
    await roster.memberUpdated(member(70, [SUPPORT]));
    events.length = 0;
    const sleeps: number[] = [];
    await expect(
      snapshotWithRetry(
        roster,
        {
          fetchAll: async () => {
            throw new Error('Gateway timeout');
          },
          fetchByIds: async () => [],
        },
        { attempts: 4, baseMs: 1000, sleep: async (ms) => void sleeps.push(ms) },
      ),
    ).rejects.toThrow('Gateway timeout');
    expect(sleeps).toEqual([1000, 2000, 4000]);
    // The member remembered before is still known, so their removal still reaches the API.
    await roster.memberRemoved(id(70), []);
    expect(events.map((e) => e.type)).toEqual(['member.removed']);
  });
});

describe('snapshot runner (I5)', () => {
  const flush = () => new Promise<void>((r) => setImmediate(r));

  it('runs one snapshot at a time, runs once more for triggers that came meanwhile, and repeats daily', async () => {
    const gates: (() => void)[] = [];
    const done: string[] = [];
    const failed: string[] = [];
    let timer: { fn: () => void; ms: number } | undefined;
    let cleared = false;
    const runner = createSnapshotRunner({
      run: () => new Promise<number>((res) => gates.push(() => res(5))),
      onDone: (n, reason) => void done.push(`${reason}:${n}`),
      onFail: (_e, reason) => void failed.push(reason),
      setIntervalFn: ((fn: () => void, ms: number) => ((timer = { fn, ms }), 1)) as never,
      clearIntervalFn: (() => void (cleared = true)) as never,
    });
    runner.trigger('startup');
    runner.trigger('invalidated');
    runner.trigger('invalidated');
    await flush();
    expect(gates).toHaveLength(1);
    gates[0]!();
    await flush();
    expect(gates).toHaveLength(2);
    gates[1]!();
    await flush();
    expect(done).toEqual(['startup:5', 'invalidated:5']);

    runner.start();
    expect(timer!.ms).toBe(24 * 60 * 60_000);
    timer!.fn();
    await flush();
    expect(gates).toHaveLength(3);
    runner.stop();
    expect(cleared).toBe(true);
    expect(failed).toEqual([]);
  });

  it('reports a failed run and can run again', async () => {
    const failed: string[] = [];
    let n = 0;
    const runner = createSnapshotRunner({
      run: async () => {
        if (++n === 1) throw new Error('nope');
        return 1;
      },
      onFail: (_e, reason) => void failed.push(reason),
    });
    runner.trigger('daily');
    await flush();
    runner.trigger('daily');
    await flush();
    expect(failed).toEqual(['daily']);
    expect(n).toBe(2);
  });
});
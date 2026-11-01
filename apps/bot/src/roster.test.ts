import { describe, expect, it } from 'vitest';
import type { BotEvent } from '@crystalaid/contracts';
import { BotEvent as BotEventSchema } from '@crystalaid/contracts';
import { createRoster, type RosterMember } from './roster.js';
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

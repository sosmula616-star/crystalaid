import { describe, expect, it } from 'vitest';
import { ActivityAuthRequest, SettingsSchema } from './api.js';
import { BotEvent } from './events.js';

const at = '2026-11-01T10:00:00.000Z';
const guildId = '123456789012345678';
const userId = '223456789012345678';

describe('BotEvent', () => {
  it('accepts member.updated', () => {
    const r = BotEvent.safeParse({
      type: 'member.updated',
      guildId,
      userId,
      username: 'a',
      avatar: null,
      roleIds: [guildId],
      at,
    });
    expect(r.success).toBe(true);
  });

  it('accepts member.removed', () => {
    expect(BotEvent.safeParse({ type: 'member.removed', guildId, userId, at }).success).toBe(true);
  });

  it('accepts member.snapshot', () => {
    const r = BotEvent.safeParse({
      type: 'member.snapshot',
      guildId,
      snapshotId: 's1',
      part: 1,
      parts: 2,
      at,
      members: [{ userId, username: 'a', avatar: 'hash', roleIds: [] }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a snapshot part beyond parts or below 1', () => {
    const base = { type: 'member.snapshot', guildId, snapshotId: 's1', at, members: [] };
    expect(BotEvent.safeParse({ ...base, part: 3, parts: 2 }).success).toBe(false);
    expect(BotEvent.safeParse({ ...base, part: 0, parts: 2 }).success).toBe(false);
    expect(BotEvent.safeParse({ ...base, part: 1, parts: 0 }).success).toBe(false);
    expect(BotEvent.safeParse({ ...base, part: 2, parts: 2 }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(BotEvent.safeParse({ type: 'member.banned', guildId, userId, at }).success).toBe(false);
  });

  it('rejects an event without guildId', () => {
    expect(BotEvent.safeParse({ type: 'member.removed', userId, at }).success).toBe(false);
  });
});

describe('SettingsSchema', () => {
  it('fills defaults from an empty object', () => {
    expect(SettingsSchema.parse({})).toEqual({
      ticketRate: 10,
      shiftHourRate: 5,
      normBonus: 50,
      weeklyNormHours: 20,
      weeklyNormTickets: 30,
      ticketWaitMinutes: 30,
      inactivityMinutes: 30,
      inactivityReplyMinutes: 10,
      warningDays: 30,
      ticketCategories: [],
    });
  });

  it('rejects a negative rate', () => {
    expect(SettingsSchema.safeParse({ ticketRate: -1 }).success).toBe(false);
  });
});

describe('ActivityAuthRequest', () => {
  it('drops an extra guildId field', () => {
    const r = ActivityAuthRequest.parse({ code: 'c', instanceId: 'i', guildId });
    expect(r).toEqual({ code: 'c', instanceId: 'i' });
  });
});

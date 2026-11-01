import { describe, expect, it } from 'vitest';
import { weekBounds } from './week.js';

describe('weekBounds', () => {
  it('starts the week on Monday 00:00 local time', () => {
    expect(weekBounds(new Date('2026-11-01T20:59:59Z'), 'Europe/Moscow').start.toISOString()).toBe(
      '2026-10-25T21:00:00.000Z',
    );
    expect(weekBounds(new Date('2026-11-01T21:00:00Z'), 'Europe/Moscow').start.toISOString()).toBe(
      '2026-11-01T21:00:00.000Z',
    );
    expect(weekBounds(new Date('2026-10-27T12:00:00Z'), 'Europe/Berlin').end.toISOString()).toBe(
      '2026-11-01T23:00:00.000Z',
    );
  });

  it('handles the DST change week in Europe/Berlin', () => {
    // DST ended on Sunday 2026-10-25 at 03:00 local.
    const during = weekBounds(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin');
    expect(during.start.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(during.end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    const next = weekBounds(new Date('2026-10-26T00:00:00Z'), 'Europe/Berlin');
    expect(next.start.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('end is exclusive start of next week', () => {
    const w = weekBounds(new Date('2026-10-28T10:00:00Z'), 'Europe/Moscow');
    expect(w.end.getTime() - w.start.getTime()).toBe(7 * 24 * 3600 * 1000);
  });
});

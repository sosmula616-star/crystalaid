import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadServerConfig, parseServerConfig } from './server-config.js';

const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';

const valid = {
  guildId: '100000000000000010',
  timezone: 'Europe/Moscow',
  roles: { support: [A], curator: [B], admin: [C] },
  channels: {
    ticketCategory: '100000000000000020',
    ticketPanel: '100000000000000021',
    reports: '100000000000000022',
    audit: '100000000000000023',
  },
};

const parse = (raw: unknown) => parseServerConfig(raw, 'test.json');
const withRoles = (roles: Record<string, string[]>) => ({
  ...valid,
  roles: { ...valid.roles, ...roles },
});

describe('parseServerConfig', () => {
  it('accepts a valid config', () => {
    expect(parse(valid).timezone).toBe('Europe/Moscow');
  });

  it('rejects an unknown timezone', () => {
    expect(() => parse({ ...valid, timezone: 'Mars/Base' })).toThrow(/timezone/);
  });

  it('rejects a non-snowflake role id', () => {
    expect(() => parse(withRoles({ support: ['123'] }))).toThrow(/roles\.support/);
  });

  it('rejects an empty role list', () => {
    expect(() => parse(withRoles({ curator: [] }))).toThrow(/roles\.curator/);
  });

  it('rejects a role id used in two lists', () => {
    expect(() => parse(withRoles({ support: [A], curator: [A] }))).toThrow(/same role/i);
  });
});

describe('loadServerConfig', () => {
  it('names the file when it is missing', () => {
    expect(() => loadServerConfig('missing.json')).toThrow(/missing\.json/);
  });

  it('loads the example config', () => {
    const cfg = loadServerConfig(
      fileURLToPath(new URL('../../../crystalaid.config.example.json', import.meta.url)),
    );
    expect(cfg.timezone).toBe('Europe/Moscow');
  });
});

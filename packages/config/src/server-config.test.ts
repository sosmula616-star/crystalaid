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
  users: { admins: [], developers: [] },
  channels: { log: '100000000000000020', help: '100000000000000024' },
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

  it('requires channels.log and channels.help; old channels are optional; users default to empty lists', () => {
    expect(() => parse({ ...valid, channels: { log: valid.channels.log } })).toThrow(/channels\.help/);
    const noUsers = { guildId: valid.guildId, timezone: valid.timezone, roles: valid.roles, channels: valid.channels };
    expect(() => parse({ ...noUsers, channels: { ticketPanel: valid.channels.log, help: valid.channels.help } })).toThrow(/channels\.log/);
    const ok = parse(noUsers);
    expect(ok.users).toEqual({ admins: [], developers: [] });
    expect(ok.channels.ticketPanel).toBeUndefined();
  });

  it('accepts user id lists and rejects a bad id', () => {
    const cfg = parse({ ...valid, users: { admins: [A], developers: [B] } });
    expect(cfg.users).toEqual({ admins: [A], developers: [B] });
    expect(() => parse({ ...valid, users: { admins: ['x'], developers: [] } })).toThrow(/users\.admins/);
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

  it('allows admins by user id with no admin role', () => {
    const roles = { support: valid.roles.support, curator: valid.roles.curator };
    const parsed = parse({ ...valid, roles, users: { admins: [C], developers: [] } });
    expect(parsed.roles.admin).toEqual([]);
    expect(parsed.users.admins).toEqual([C]);
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

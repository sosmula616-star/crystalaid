import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'client-secret-value',
  DISCORD_BOT_TOKEN: 'bot-token-value-abcdef',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'j'.repeat(32),
  SERVICE_TOKEN: 's'.repeat(32),
};

describe('loadEnv', () => {
  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a malformed TRUSTED_PROXIES entry', () => {
    for (const bad of ['nonsense', '10.0.0.0/33', '10.0.0.1, bogus', '::1/129', '10.0.0.1/', '0.0.0.0/0', '::/0', '10.0.0.0/00']) {
      expect(() => loadEnv({ ...valid, TRUSTED_PROXIES: bad })).toThrow(/TRUSTED_PROXIES/);
    }
  });

  it('parses TRUSTED_PROXIES into a list of IPs and CIDRs', () => {
    const env = loadEnv({ ...valid, TRUSTED_PROXIES: ' 10.0.0.1, 192.168.0.0/16 ,::1,fd00::/8' });
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.1', '192.168.0.0/16', '::1', 'fd00::/8']);
  });

  it('does not include secret values in the error', () => {
    try {
      loadEnv({ ...valid, JWT_SECRET: 'short-secret-xyz' });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-xyz');
      return;
    }
    expect.unreachable('loadEnv should have thrown');
  });

  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.DISCORD_API_URL).toBe('https://discord.com/api/v10');
    expect(env.TRUSTED_PROXIES).toEqual([]);
    expect(env.PORT).toBe(3001);
  });

  it('coerces numeric values from strings', () => {
    const env = loadEnv({ ...valid, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });
});

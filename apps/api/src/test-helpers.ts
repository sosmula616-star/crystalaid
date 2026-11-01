import { Redis } from 'ioredis';
import type { Env, ServerConfig } from '@crystalaid/config';
import type { Logger } from './log.js';

export const GUILD = '100000000000000001';
export const SUPPORT_ROLE = '100000000000000011';
export const CURATOR_ROLE = '100000000000000012';
export const ADMIN_ROLE = '100000000000000013';

export const config: ServerConfig = {
  guildId: GUILD,
  timezone: 'Europe/Moscow',
  roles: { support: [SUPPORT_ROLE], curator: [CURATOR_ROLE], admin: [ADMIN_ROLE] },
  users: { admins: [], developers: [] },
  channels: { log: '100000000000000021', help: '100000000000000022' },
};

export function discordId(n: number): string {
  return `2000000000000${String(n).padStart(5, '0')}`;
}

export function memberInput(n: number, roleIds: string[], at = new Date()) {
  return { userId: discordId(n), username: `user${n}`, avatar: null, roleIds, at };
}

export function recordingLog(): Logger & { warns: string[]; errors: string[]; infos: string[] } {
  const warns: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    warns,
    errors,
    infos,
    info: (m) => void infos.push(m),
    warn: (m) => void warns.push(m),
    error: (m) => void errors.push(m),
  };
}

/** Redis for tests. Tests clear only the keys they own, never the whole database. */
export function testRedis(): Redis {
  const url = process.env.TEST_REDIS_URL;
  if (!url) throw new Error('TEST_REDIS_URL is not set');
  if (url === process.env.REDIS_URL) throw new Error('TEST_REDIS_URL must differ from REDIS_URL');
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

export async function clearOwnedKeys(redis: Redis): Promise<void> {
  const owned = [...(await redis.keys('snapshot:*')), ...(await redis.keys('ratelimit:*'))];
  await redis.del('events:bot', 'events:dead', ...owned);
}

export const CLIENT_ID = '300000000000000001';
export const CLIENT_SECRET = 'client-secret-value-9f3a';
export const BOT_TOKEN = 'bot-token-value-7c1e';
export const JWT_SECRET = 'jwt-secret-for-tests-0123456789abcdef';
export const SERVICE_TOKEN = 'service-token-for-tests-0123456789abcd';

export function testEnv(discordApiUrl: string): Env {
  return {
    DISCORD_CLIENT_ID: CLIENT_ID,
    DISCORD_CLIENT_SECRET: CLIENT_SECRET,
    DISCORD_BOT_TOKEN: BOT_TOKEN,
    DISCORD_API_URL: discordApiUrl,
    DATABASE_URL: 'postgres://unused',
    REDIS_URL: 'redis://unused',
    JWT_SECRET,
    SERVICE_TOKEN,
    TRUSTED_PROXIES: [],
    PORT: 3001,
  };
}

import { AppError } from '@crystalaid/contracts';
import type { Env } from '@crystalaid/config';
import { consoleLog, type Logger } from '../log.js';

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ActivityInstance {
  instanceId: string;
  location: { id: string; kind: string; channel_id?: string; guild_id?: string };
  /** Discord ids of the users in the instance. */
  users: string[];
}

export interface GuildMember {
  roles: string[];
}

export interface DiscordClient {
  /** Returns the user's OAuth access token. */
  exchangeCode(code: string): Promise<string>;
  getCurrentUser(accessToken: string): Promise<DiscordUser>;
  /** Null when Discord has no such instance. */
  getActivityInstance(instanceId: string): Promise<ActivityInstance | null>;
  /** Null when the user is not a member of the guild. */
  getMember(guildId: string, userId: string): Promise<GuildMember | null>;
}

const TIMEOUT_MS = 5000;
/** Discord asks bots to identify themselves: DiscordBot (url, version). */
export const USER_AGENT = 'DiscordBot (https://github.com/sosmula616-star/crystalaid, 1.0.0)';

/**
 * Discord REST client. Rate limits (429), server errors and network failures or timeouts all
 * become `DISCORD_UNAVAILABLE`; nothing is retried. Each such failure is logged as a warning
 * with the endpoint name and status only: never tokens, ids or response bodies, which may echo
 * credentials.
 */
export function createDiscordClient(
  env: Pick<Env, 'DISCORD_API_URL' | 'DISCORD_CLIENT_ID' | 'DISCORD_CLIENT_SECRET' | 'DISCORD_BOT_TOKEN'>,
  log: Logger = consoleLog,
): DiscordClient {
  const base = env.DISCORD_API_URL.replace(/\/+$/, '');

  function unavailable(endpoint: string, detail: { status?: number; reason?: string }): AppError {
    log.warn('discord request failed', { endpoint, ...detail });
    return new AppError('DISCORD_UNAVAILABLE', 'Discord is unavailable', 503);
  }

  async function call(endpoint: string, path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'user-agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw unavailable(endpoint, { reason: timedOut ? 'timeout' : 'network' });
    }
    if (res.status === 429 || res.status >= 500) throw unavailable(endpoint, { status: res.status });
    return res;
  }

  async function json<T>(endpoint: string, res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw unavailable(endpoint, { status: res.status, reason: 'unreadable body' });
    }
  }

  const bot = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };

  return {
    async exchangeCode(code) {
      const res = await call('oauth2/token', '/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
        }),
      });
      // 401 means Discord rejected our own client id or secret: a configuration fault, not a bad code.
      if (res.status === 401) {
        throw unavailable('oauth2/token', { status: 401, reason: 'client credentials rejected' });
      }
      if (res.status >= 400 && res.status < 500) {
        throw new AppError('UNAUTHORIZED', 'Invalid authorization code', 401);
      }
      const body = await json<{ access_token?: unknown }>('oauth2/token', res);
      if (typeof body.access_token !== 'string') {
        throw unavailable('oauth2/token', { reason: 'no access token' });
      }
      return body.access_token;
    },

    async getCurrentUser(accessToken) {
      const res = await call('users/@me', '/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401 || res.status === 403) {
        throw new AppError('UNAUTHORIZED', 'Invalid Discord token', 401);
      }
      if (!res.ok) throw unavailable('users/@me', { status: res.status });
      const body = await json<Partial<DiscordUser>>('users/@me', res);
      if (typeof body.id !== 'string' || typeof body.username !== 'string') {
        throw unavailable('users/@me', { reason: 'unexpected body' });
      }
      return { id: body.id, username: body.username, avatar: body.avatar ?? null };
    },

    async getActivityInstance(instanceId) {
      const res = await call(
        'activity-instances',
        `/applications/${encodeURIComponent(env.DISCORD_CLIENT_ID)}/activity-instances/${encodeURIComponent(instanceId)}`,
        { headers: bot },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw unavailable('activity-instances', { status: res.status });
      const body = await json<Partial<ActivityInstance>>('activity-instances', res);
      if (!body.location || !Array.isArray(body.users)) {
        throw unavailable('activity-instances', { reason: 'unexpected body' });
      }
      return { instanceId, location: body.location, users: body.users };
    },

    async getMember(guildId, userId) {
      const res = await call(
        'guild-member',
        `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
        { headers: bot },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw unavailable('guild-member', { status: res.status });
      const body = await json<Partial<GuildMember>>('guild-member', res);
      if (!Array.isArray(body.roles)) throw unavailable('guild-member', { reason: 'unexpected body' });
      return { roles: body.roles };
    },
  };
}

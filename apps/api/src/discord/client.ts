import { AppError } from '@crystalaid/contracts';
import type { Env } from '@crystalaid/config';

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

const unavailable = () => new AppError('DISCORD_UNAVAILABLE', 'Discord is unavailable', 503);

/**
 * Discord REST client. Rate limits (429), server errors and network failures or timeouts all
 * become `DISCORD_UNAVAILABLE`; nothing is retried. Messages never contain response bodies,
 * which may echo credentials.
 */
export function createDiscordClient(
  env: Pick<Env, 'DISCORD_API_URL' | 'DISCORD_CLIENT_ID' | 'DISCORD_CLIENT_SECRET' | 'DISCORD_BOT_TOKEN'>,
): DiscordClient {
  const base = env.DISCORD_API_URL.replace(/\/+$/, '');

  async function call(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw unavailable();
    }
    if (res.status === 429 || res.status >= 500) throw unavailable();
    return res;
  }

  async function json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw unavailable();
    }
  }

  const bot = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };

  return {
    async exchangeCode(code) {
      const res = await call('/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
        }),
      });
      if (res.status >= 400 && res.status < 500) {
        throw new AppError('UNAUTHORIZED', 'Invalid authorization code', 401);
      }
      const body = await json<{ access_token?: unknown }>(res);
      if (typeof body.access_token !== 'string') throw unavailable();
      return body.access_token;
    },

    async getCurrentUser(accessToken) {
      const res = await call('/users/@me', { headers: { authorization: `Bearer ${accessToken}` } });
      if (res.status === 401 || res.status === 403) {
        throw new AppError('UNAUTHORIZED', 'Invalid Discord token', 401);
      }
      if (!res.ok) throw unavailable();
      const body = await json<Partial<DiscordUser>>(res);
      if (typeof body.id !== 'string' || typeof body.username !== 'string') throw unavailable();
      return { id: body.id, username: body.username, avatar: body.avatar ?? null };
    },

    async getActivityInstance(instanceId) {
      const res = await call(
        `/applications/${encodeURIComponent(env.DISCORD_CLIENT_ID)}/activity-instances/${encodeURIComponent(instanceId)}`,
        { headers: bot },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw unavailable();
      const body = await json<Partial<ActivityInstance>>(res);
      if (!body.location || !Array.isArray(body.users)) throw unavailable();
      return { instanceId, location: body.location, users: body.users };
    },

    async getMember(guildId, userId) {
      const res = await call(
        `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
        { headers: bot },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw unavailable();
      const body = await json<Partial<GuildMember>>(res);
      if (!Array.isArray(body.roles)) throw unavailable();
      return { roles: body.roles };
    },
  };
}

import type { ActivityAuthResponse } from '@crystalaid/contracts';
import { ApiError } from '../api/client.js';
import { withTimeout } from '../timeout.js';

/** What the app needs from the Discord Embedded App SDK. Tests replace it. */
export interface DiscordPort {
  /** Resolves when the SDK handshake is done. */
  ready(): Promise<void>;
  /** Asks Discord for an authorization code (scopes identify, guilds; no prompt). */
  authorize(): Promise<string>;
  authenticate(discordAccessToken: string): Promise<void>;
  readonly instanceId: string;
  /** Discord locale such as `ru` or `en-US`; known after `authenticate()`, if Discord answered in time. */
  readonly locale: string | undefined;
  /** Subscribes to layout mode changes; returns the unsubscribe function. */
  onLayoutMode(callback: (mode: number) => void): () => void;
}

export interface SessionDeps {
  sdk: DiscordPort;
  login(code: string, instanceId: string): Promise<ActivityAuthResponse>;
  /** Limit for the handshake steps `ready` and `authenticate`. Default 15 s. */
  timeoutMs?: number;
  /** Limit for `authorize`, which may wait for a person reading Discord's consent dialog. Default 5 min. */
  authorizeTimeoutMs?: number;
}

export interface Session {
  start(): Promise<void>;
  /** Signs in again with a fresh code. Concurrent calls share one run. */
  refresh(): Promise<void>;
  /** The session token. Lives only in this closure, never in storage. */
  token(): string | null;
}

export function createSession({ sdk, login, timeoutMs = 15_000, authorizeTimeoutMs = 300_000 }: SessionDeps): Session {
  const limited = <T>(promise: Promise<T>, step: string, limit = timeoutMs) =>
    withTimeout(promise, limit, () => new ApiError('NETWORK', `Discord did not answer: ${step}`, 0));
  let token: string | null = null;
  let isReady = false;
  let isAuthenticated = false;
  let refreshing: Promise<void> | null = null;

  async function signIn(): Promise<ActivityAuthResponse> {
    const code = await limited(sdk.authorize(), 'authorize', authorizeTimeoutMs);
    const response = await login(code, sdk.instanceId);
    token = response.sessionToken;
    return response;
  }

  return {
    async start() {
      if (!isReady) {
        await limited(sdk.ready(), 'ready');
        isReady = true;
      }
      const response = await signIn();
      if (!isAuthenticated) {
        await limited(sdk.authenticate(response.discordAccessToken), 'authenticate');
        isAuthenticated = true;
      }
    },
    refresh() {
      refreshing ??= signIn()
        .then(() => undefined)
        .finally(() => {
          refreshing = null;
        });
      return refreshing;
    },
    token: () => token,
  };
}

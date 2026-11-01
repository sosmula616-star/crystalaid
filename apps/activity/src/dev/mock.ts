// Dev only: main.tsx imports this behind `import.meta.env.DEV`, so it never ships.
import type { ActivityAuthResponse, MeResponse } from '@crystalaid/contracts';
import type { DiscordPort } from '../auth/session.js';

type Level = Exclude<MeResponse['level'], 'NONE'>;

const LEVELS: readonly Level[] = ['SUPPORT', 'CURATOR', 'ADMIN', 'DEVELOPER'];

/** Auth codes the scenario `?error=CODE` can produce, with the status the API uses. */
const ERROR_STATUS: Record<string, number> = {
  NOT_STAFF: 403,
  GUILD_REQUIRED: 400,
  INVALID_INSTANCE: 403,
  DISCORD_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** What the real API sends: an English message, plus a machine-readable reason where it has one. */
const ERROR_BODY: Record<string, { message: string; reason?: string }> = {
  NOT_STAFF: { message: 'No access to the staff panel', reason: 'not_in_branch' },
  GUILD_REQUIRED: { message: 'Open the Activity in a server' },
  INVALID_INSTANCE: { message: 'Invalid activity instance' },
  DISCORD_UNAVAILABLE: { message: 'Discord is unavailable' },
  INTERNAL: { message: 'Internal server error' },
};

const LONG_NAME = 'Konstantina Aleksandrovna Wilhelmina-Ros';

const PEOPLE: Record<Level, Pick<MeResponse, 'position' | 'tokenBalance' | 'permissions'> & { name: string }> = {
  SUPPORT: { name: 'Marta Voss', position: null, tokenBalance: 340, permissions: [] },
  CURATOR: {
    name: 'Dmitri Aldous',
    position: 'Старший куратор',
    tokenBalance: 1250,
    permissions: ['tickets.view_all', 'reports.view'],
  },
  DEVELOPER: {
    name: 'Ada Kern',
    position: 'Разработчик',
    tokenBalance: 0,
    permissions: ['tickets.view_all', 'reports.view', 'payroll.approve', 'shop.manage'],
  },
  ADMIN: {
    name: 'Ilya Brandt',
    position: 'Руководитель',
    tokenBalance: 8200,
    permissions: ['tickets.view_all', 'reports.view', 'payroll.approve', 'shop.manage'],
  },
};

export interface Mock {
  sdk: DiscordPort;
  fetch: typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fake Discord SDK and fake API answers, driven by the page address:
 * `?level=SUPPORT|CURATOR|ADMIN|DEVELOPER`, `?name=long`, `?error=NOT_STAFF` (or another auth code),
 * `?pip=1` / `?pip=0` (layout mode after start) and `?locale=en-US`.
 * `window.__crystalaidLayout(mode)` emits a layout mode by hand.
 */
export function createMock(params: URLSearchParams): Mock {
  const requested = params.get('level')?.toUpperCase();
  const level = LEVELS.find((l) => l === requested) ?? 'SUPPORT';
  const person = PEOPLE[level];
  const errorCode = params.get('error')?.toUpperCase() ?? null;
  const pip = params.get('pip');

  const listeners = new Set<(mode: number) => void>();
  let currentMode: number | null = null;
  const emit = (mode: number) => {
    currentMode = mode;
    for (const listener of listeners) listener(mode);
  };
  (window as unknown as { __crystalaidLayout: (mode: number) => void }).__crystalaidLayout = emit;

  const sdk: DiscordPort = {
    instanceId: 'mock-instance',
    locale: params.get('locale') ?? 'ru',
    async ready() {},
    async authorize() {
      return 'mock-code';
    },
    async authenticate() {
      if (pip === '1' || pip === '0') currentMode = Number(pip);
    },
    onLayoutMode(callback) {
      listeners.add(callback);
      // The shell subscribes after the sign-in; it still gets the mode the scenario asked for.
      if (currentMode !== null) {
        const mode = currentMode;
        setTimeout(() => callback(mode), 0);
      }
      return () => {
        listeners.delete(callback);
      };
    },
  };

  const me: MeResponse = {
    user: {
      id: 'mock-user',
      discordId: '123456789012345678',
      username: params.get('name') === 'long' ? LONG_NAME : person.name,
      avatar: null,
    },
    level,
    position: person.position,
    status: 'active',
    tokenBalance: person.tokenBalance,
    permissions: person.permissions,
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.pathname === '/api/auth/activity') {
      if (errorCode) {
        const { message, reason } = ERROR_BODY[errorCode] ?? { message: 'Mock error' };
        const reasonOverride = params.get('reason') ?? reason;
        return json(
          { error: { code: errorCode, message, requestId: 'mock-request', ...(reasonOverride ? { reason: reasonOverride } : {}) } },
          ERROR_STATUS[errorCode] ?? 500,
        );
      }
      const body: ActivityAuthResponse = {
        sessionToken: 'mock-session-token',
        discordAccessToken: 'mock-discord-token',
        expiresIn: 3600,
      };
      return json(body);
    }
    if (method === 'GET' && url.pathname === '/api/me') return json(me);
    return json({ error: { code: 'NOT_FOUND', message: `No mock for ${method} ${url.pathname}` } }, 404);
  };

  return { sdk, fetch: mockFetch };
}

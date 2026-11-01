import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@crystalaid/contracts';
import { ApiError, type ApiClient } from '../api/client.js';
import { AuthGate, type AuthGateContext } from './AuthGate.js';
import type { Session } from './session.js';

const ME: MeResponse = {
  user: { id: 'u1', discordId: '123456789012345678', username: 'alice', avatar: null },
  level: 'SUPPORT',
  position: null,
  status: 'active',
  tokenBalance: 5,
  permissions: [],
};

function setup(
  opts: {
    start?: () => Promise<void>;
    me?: () => Promise<MeResponse>;
    locale?: string | null;
    strict?: boolean;
  } = {},
) {
  const session: Session = {
    start: vi.fn(opts.start ?? (async () => {})),
    refresh: vi.fn(async () => {}),
    token: () => 'tok',
  };
  const api = {
    get: vi.fn(opts.me ?? (async () => ME)),
    post: vi.fn(),
    patch: vi.fn(),
  } as unknown as ApiClient;
  const context: { current: AuthGateContext | null } = { current: null };
  const locale = opts.locale === null ? undefined : (opts.locale ?? 'ru');
  const gate = (
    <AuthGate session={session} api={api} discordLocale={() => locale}>
      {(me, ctx) => {
        context.current = ctx;
        return <p>hello {me.user.username}</p>;
      }}
    </AuthGate>
  );
  render(opts.strict ? <StrictMode>{gate}</StrictMode> : gate);
  return { session, api, context };
}

describe('AuthGate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the logo and an indicator while signing in, then the children with /me', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU'); // before Discord answers, the browser language is used
    let finish!: () => void;
    const { api } = setup({ start: () => new Promise<void>((r) => (finish = r)) });
    expect(screen.getByRole('img', { name: 'Логотип CrystalAid' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Выполняется вход');
    finish();
    expect(await screen.findByText('hello alice')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/me', expect.anything());
    expect(document.documentElement.lang).toBe('ru');
  });

  it('uses English text and document language for an English Discord locale', async () => {
    setup({ locale: 'en-US' });
    await screen.findByText('hello alice');
    expect(document.documentElement.lang).toBe('en');
  });

  it('explains a missing support role in Russian, not with the server text', async () => {
    setup({
      me: async () => {
        throw new ApiError('NOT_STAFF', 'No access: the support role is missing', 403, undefined, 'support_role_missing');
      },
    });
    expect(await screen.findByText('Нет доступа')).toBeTruthy();
    expect(screen.getByText(/нужна роль саппорта/)).toBeTruthy();
    expect(screen.queryByText('No access: the support role is missing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('says the person is not in the branch for reason not_in_branch', async () => {
    setup({
      me: async () => {
        throw new ApiError('NOT_STAFF', 'No access to the staff panel', 403, undefined, 'not_in_branch');
      },
    });
    expect(await screen.findByText(/нет роли сотрудника/)).toBeTruthy();
  });

  it('falls back to a generic text for an unknown or missing reason', async () => {
    setup({
      me: async () => {
        throw new ApiError('NOT_STAFF', 'Server words', 403, undefined, 'something_new');
      },
    });
    expect(await screen.findByText('У вас нет доступа к панели сотрудников.')).toBeTruthy();
    expect(screen.queryByText('Server words')).toBeNull();
  });

  it('does not treat an inherited key as a reason', async () => {
    setup({
      me: async () => {
        throw new ApiError('NOT_STAFF', 'Server words', 403, undefined, 'constructor');
      },
    });
    expect(await screen.findByText('У вас нет доступа к панели сотрудников.')).toBeTruthy();
  });

  it('shows the NOT_STAFF screen when the login itself is refused', async () => {
    setup({
      start: async () => {
        throw new ApiError('NOT_STAFF', 'No access to the staff panel', 403);
      },
    });
    expect(await screen.findByText('У вас нет доступа к панели сотрудников.')).toBeTruthy();
    expect(screen.queryByText('No access to the staff panel')).toBeNull();
  });

  it('shows its own screen for GUILD_REQUIRED', async () => {
    setup({
      start: async () => {
        throw new ApiError('GUILD_REQUIRED', 'Open the Activity in a server', 400);
      },
    });
    expect(await screen.findByText('Откройте панель на сервере')).toBeTruthy();
    expect(screen.queryByText('Open the Activity in a server')).toBeNull();
  });

  it('shows its own screen for INVALID_INSTANCE', async () => {
    setup({
      start: async () => {
        throw new ApiError('INVALID_INSTANCE', 'Invalid activity instance', 403);
      },
    });
    expect(await screen.findByText('Запустите панель заново')).toBeTruthy();
  });

  it.each([
    ['DISCORD_UNAVAILABLE', new ApiError('DISCORD_UNAVAILABLE', 'Discord is down', 502)],
    ['NETWORK', new ApiError('NETWORK', 'Failed to fetch', 0)],
    ['an SDK failure', new Error('Discord client closed')],
  ])('shows the connection screen with a retry button for %s', async (_name, error) => {
    setup({
      start: async () => {
        throw error;
      },
    });
    expect(await screen.findByText('Не удалось подключиться')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('runs the sign-in again when Retry is pressed', async () => {
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ApiError('DISCORD_UNAVAILABLE', 'down', 502))
      .mockResolvedValue(undefined);
    const { api } = setup({ start });
    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('hello alice')).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('retries a failed /me', async () => {
    const me = vi
      .fn<() => Promise<MeResponse>>()
      .mockRejectedValueOnce(new ApiError('NETWORK', 'offline', 0))
      .mockResolvedValue(ME);
    setup({ me });
    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByText('hello alice')).toBeTruthy());
  });

  it('starts the sign-in once under StrictMode', async () => {
    const { session, api } = setup({ strict: true });
    await screen.findByText('hello alice');
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('lets a stored language win over the Discord locale, and switches through the context', async () => {
    localStorage.setItem('crystalaid.locale', 'en');
    const { context } = setup({ locale: 'ru' });
    expect(await screen.findByText('hello alice')).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    act(() => context.current?.setLocale('ru'));
    expect(document.documentElement.lang).toBe('ru');
    localStorage.clear();
  });

  it('keeps a language chosen this session when saving it failed, also after a retry', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { context } = setup({ locale: 'ru' });
    expect(await screen.findByText('hello alice')).toBeTruthy();
    act(() => context.current?.setLocale('en'));
    expect(document.documentElement.lang).toBe('en');
    act(() => context.current?.retryAuth());
    await waitFor(() => expect(screen.getByText('hello alice')).toBeTruthy());
    expect(document.documentElement.lang).toBe('en');
    vi.restoreAllMocks();
  });

  it('ignores a stored language it does not know', async () => {
    localStorage.setItem('crystalaid.locale', 'xx');
    setup({ locale: 'en-US' });
    expect(await screen.findByText('hello alice')).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    localStorage.clear();
  });

  it('keeps the current locale when Discord reports none', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    setup({
      locale: null,
      start: async () => {
        throw new ApiError('DISCORD_UNAVAILABLE', 'down', 502);
      },
    });
    expect(await screen.findByText('Не удалось подключиться')).toBeTruthy();
    expect(document.documentElement.lang).toBe('ru');
  });

  it('moves focus to the heading of a failure screen, also after Retry', async () => {
    const start = vi.fn<() => Promise<void>>().mockRejectedValue(new ApiError('NETWORK', 'offline', 0));
    setup({ start });
    const heading = await screen.findByRole('heading', { name: 'Не удалось подключиться' });
    expect(document.activeElement).toBe(heading);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    const again = await screen.findByRole('heading', { name: 'Не удалось подключиться' });
    await waitFor(() => expect(document.activeElement).toBe(again));
  });

  it('labels the toast region from i18n', async () => {
    setup();
    await screen.findByText('hello alice');
    expect(document.querySelector('[aria-label^=\'Уведомления\']')).toBeTruthy();
  });

  it('shows the failure screen with Retry when a child reports a failed re-login', async () => {
    const { context, session } = setup();
    await screen.findByText('hello alice');
    act(() => context.current!.reportAuthFailure(new ApiError('DISCORD_UNAVAILABLE', 'down', 502)));
    expect(await screen.findByText('Не удалось подключиться')).toBeTruthy();
    expect(screen.queryByText('hello alice')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('hello alice')).toBeTruthy();
    expect(session.start).toHaveBeenCalledTimes(2);
  });

  it('retryAuth in the context runs the sign-in again', async () => {
    const { context, session } = setup();
    await screen.findByText('hello alice');
    act(() => context.current!.retryAuth());
    await waitFor(() => expect(session.start).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('hello alice')).toBeTruthy();
  });
});

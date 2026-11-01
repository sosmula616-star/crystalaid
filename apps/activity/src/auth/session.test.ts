import { describe, expect, it, vi } from 'vitest';
import { createSession, type DiscordPort } from './session.js';

function setup() {
  const order: string[] = [];
  let n = 0;
  const sdk: DiscordPort = {
    instanceId: 'inst-1',
    locale: 'ru',
    ready: vi.fn(async () => void order.push('ready')),
    authorize: vi.fn(async () => {
      order.push('authorize');
      return `code-${++n}`;
    }),
    authenticate: vi.fn(async () => void order.push('authenticate')),
    onLayoutMode: vi.fn(() => () => {}),
  };
  const login = vi.fn(async (code: string) => {
    order.push('login');
    return { sessionToken: `token-for-${code}`, discordAccessToken: 'discord-token', expiresIn: 60 };
  });
  return { sdk, login, order, session: createSession({ sdk, login }) };
}

describe('session', () => {
  it('starts in the order ready, authorize, login, authenticate', async () => {
    const { session, order, sdk, login } = setup();
    expect(session.token()).toBeNull();
    await session.start();
    expect(order).toEqual(['ready', 'authorize', 'login', 'authenticate']);
    expect(login).toHaveBeenCalledWith('code-1', 'inst-1');
    expect(sdk.authenticate).toHaveBeenCalledWith('discord-token');
    expect(session.token()).toBe('token-for-code-1');
  });

  it('keeps the token out of storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { session } = setup();
    await session.start();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('refresh repeats authorize and login but not authenticate', async () => {
    const { session, order, sdk } = setup();
    await session.start();
    order.length = 0;
    await session.refresh();
    expect(order).toEqual(['authorize', 'login']);
    expect(sdk.authenticate).toHaveBeenCalledTimes(1);
    expect(session.token()).toBe('token-for-code-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const { session, login } = setup();
    await session.start();
    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('allows a new refresh after a failed one', async () => {
    const { session, login } = setup();
    await session.start();
    login.mockRejectedValueOnce(new Error('down'));
    await expect(session.refresh()).rejects.toThrow('down');
    await expect(session.refresh()).resolves.toBeUndefined();
  });

  it('start can be run again after a failure and authenticates once', async () => {
    const { session, sdk, login } = setup();
    login.mockRejectedValueOnce(new Error('down'));
    await expect(session.start()).rejects.toThrow('down');
    await session.start();
    await session.start();
    expect(sdk.authenticate).toHaveBeenCalledTimes(1);
    expect(sdk.ready).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ready', 15_000],
    ['authorize', 300_000],
    ['authenticate', 15_000],
  ] as const)('reports a stalled %s as NETWORK after its limit', async (step, limit) => {
    vi.useFakeTimers();
    try {
      const { sdk, login } = setup();
      (sdk[step] as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
      const session = createSession({ sdk, login });
      const result = session.start().catch((e: unknown) => e);
      let settled = false;
      void result.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(limit - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ code: 'NETWORK' });
      if (step !== 'authenticate') expect(login).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

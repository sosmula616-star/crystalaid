import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordPort, type SdkLike } from './discord.js';

function fakeSdk(overrides: { locale?: () => Promise<{ locale: string }>; subscribe?: () => Promise<unknown> } = {}) {
  const calls: string[] = [];
  const sdk: SdkLike = {
    instanceId: 'inst-9',
    ready: vi.fn(async () => void calls.push('ready')),
    commands: {
      authorize: vi.fn(async () => {
        calls.push('authorize');
        return { code: 'the-code' };
      }),
      authenticate: vi.fn(async () => void calls.push('authenticate')),
      userSettingsGetLocale: vi.fn(async () => {
        calls.push('locale');
        return overrides.locale ? overrides.locale() : { locale: 'ru' };
      }),
    },
    subscribe: vi.fn(overrides.subscribe ?? (async () => undefined)),
    unsubscribe: vi.fn(async () => undefined),
  };
  return { sdk, calls, port: createDiscordPort('client-1', () => sdk, 3000) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('discord port', () => {
  it('creates the SDK on ready and authorizes with the right scopes, silently', async () => {
    const { port, sdk } = fakeSdk();
    expect(() => port.instanceId).toThrow();
    await port.ready();
    expect(await port.authorize()).toBe('the-code');
    expect(port.instanceId).toBe('inst-9');
    expect(sdk.commands.authorize).toHaveBeenCalledWith({
      client_id: 'client-1',
      response_type: 'code',
      prompt: 'none',
      scope: ['identify', 'guilds'],
    });
  });

  it('reads the locale after authenticate, not in ready', async () => {
    const { port, calls, sdk } = fakeSdk();
    await port.ready();
    await port.authorize();
    expect(port.locale).toBeUndefined();
    await port.authenticate('discord-token');
    expect(calls).toEqual(['ready', 'authorize', 'authenticate', 'locale']);
    expect(sdk.commands.authenticate).toHaveBeenCalledWith({ access_token: 'discord-token' });
    expect(port.locale).toBe('ru');
  });

  it('does not fail authenticate when the locale call rejects', async () => {
    const { port } = fakeSdk({ locale: () => Promise.reject(new Error('no scope')) });
    await port.ready();
    await expect(port.authenticate('t')).resolves.toBeUndefined();
    expect(port.locale).toBeUndefined();
  });

  it('does not wait for a stalled locale call longer than the timeout', async () => {
    vi.useFakeTimers();
    const { port } = fakeSdk({ locale: () => new Promise(() => {}) });
    await port.ready();
    let done = false;
    const pending = port.authenticate('t').then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(done).toBe(true);
    expect(port.locale).toBeUndefined();
  });

  it('subscribes to layout mode updates and unsubscribes', async () => {
    const { port, sdk } = fakeSdk();
    await port.ready();
    const callback = vi.fn();
    const off = port.onLayoutMode(callback);
    const listener = vi.mocked(sdk.subscribe).mock.calls[0]![1];
    listener({ layout_mode: 2 });
    expect(callback).toHaveBeenCalledWith(2);
    off();
    expect(sdk.unsubscribe).toHaveBeenCalledWith(expect.anything(), listener);
  });

  it('logs a warning when subscribe is rejected instead of leaving it unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { port } = fakeSdk({ subscribe: () => Promise.reject(new Error('denied')) });
    await port.ready();
    port.onLayoutMode(() => {});
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});

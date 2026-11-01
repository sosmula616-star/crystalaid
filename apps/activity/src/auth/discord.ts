import { DiscordSDK, Events } from '@discord/embedded-app-sdk';
import { withTimeout } from '../timeout.js';
import type { DiscordPort } from './session.js';

/** The part of DiscordSDK this port uses. Tests provide a fake. */
export interface SdkLike {
  readonly instanceId: string;
  ready(): Promise<void>;
  commands: {
    authorize(args: {
      client_id: string;
      response_type: 'code';
      prompt: 'none';
      scope: ('identify' | 'guilds')[];
    }): Promise<{ code: string }>;
    authenticate(args: { access_token: string }): Promise<unknown>;
    userSettingsGetLocale(): Promise<{ locale: string }>;
  };
  subscribe(event: typeof Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener: (e: { layout_mode: number }) => unknown): Promise<unknown>;
  unsubscribe(event: typeof Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener: (e: { layout_mode: number }) => unknown): Promise<unknown>;
}

const LOCALE_TIMEOUT_MS = 3000;

/**
 * Wraps the real DiscordSDK. It only works inside a Discord iframe: the SDK is
 * created on `ready()`, so opening the page in a plain browser fails on sign-in
 * (and shows the connection screen) instead of breaking the whole page.
 */
export function createDiscordPort(
  clientId: string,
  createSdk: (clientId: string) => SdkLike = (id) => new DiscordSDK(id) as unknown as SdkLike,
  localeTimeoutMs = LOCALE_TIMEOUT_MS,
): DiscordPort {
  let sdk: SdkLike | null = null;
  let locale: string | undefined;

  const current = (): SdkLike => {
    if (!sdk) throw new Error('Discord SDK is not ready');
    return sdk;
  };

  return {
    get instanceId() {
      return current().instanceId;
    },
    get locale() {
      return locale;
    },
    async ready() {
      sdk ??= createSdk(clientId);
      await sdk.ready();
    },
    async authorize() {
      const { code } = await current().commands.authorize({
        client_id: clientId,
        response_type: 'code',
        prompt: 'none',
        scope: ['identify', 'guilds'],
      });
      return code;
    },
    async authenticate(discordAccessToken) {
      const discord = current();
      await discord.commands.authenticate({ access_token: discordAccessToken });
      // The locale is a convenience that needs the authenticated session. It can fail
      // or stall; sign-in must not wait for it longer than the timeout, nor fail.
      try {
        const result = await withTimeout(
          discord.commands.userSettingsGetLocale(),
          localeTimeoutMs,
          () => new Error('locale timeout'),
        );
        locale = result.locale;
      } catch {
        locale = undefined;
      }
    },
    onLayoutMode(callback) {
      const discord = current();
      const listener = (event: { layout_mode: number }) => callback(event.layout_mode);
      const warn = (action: string) => (error: unknown) =>
        console.warn(`Discord ${action} of the layout mode failed`, error);
      discord.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener).catch(warn('subscribe'));
      return () => {
        discord.unsubscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener).catch(warn('unsubscribe'));
      };
    },
  };
}

import { DiscordSDK, Events } from '@discord/embedded-app-sdk';
import type { DiscordPort } from './session.js';

/**
 * Wraps the real DiscordSDK. It only works inside a Discord iframe: the SDK is
 * created on `ready()`, so opening the page in a plain browser fails on sign-in
 * (and shows the connection screen) instead of breaking the whole page.
 */
export function createDiscordPort(clientId: string): DiscordPort {
  let sdk: DiscordSDK | null = null;
  let locale: string | undefined;

  const current = (): DiscordSDK => {
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
      sdk ??= new DiscordSDK(clientId);
      await sdk.ready();
      try {
        locale = (await sdk.commands.userSettingsGetLocale()).locale;
      } catch {
        // The locale is a convenience: fall back to the browser language.
        locale = navigator.language;
      }
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
      await current().commands.authenticate({ access_token: discordAccessToken });
    },
    onLayoutMode(callback) {
      const discord = current();
      const listener = (event: { layout_mode: number }) => callback(event.layout_mode);
      void discord.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener);
      return () => void discord.unsubscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, listener);
    },
  };
}

declare global {
  interface Window {
    /** Set by the API in index.html from DISCORD_CLIENT_ID (see apps/api/src/http/static.ts). */
    __CRYSTALAID_CLIENT_ID__?: string;
  }
}

/**
 * The Discord application id. The API injects it into index.html at runtime, so one build works
 * for any deployment; the build-time VITE_DISCORD_CLIENT_ID is the fallback for the dev server.
 */
export function readClientId(
  runtime: string | undefined = typeof window === 'undefined' ? undefined : window.__CRYSTALAID_CLIENT_ID__,
  buildTime: string | undefined = import.meta.env.VITE_DISCORD_CLIENT_ID,
): string {
  return runtime?.trim() || buildTime?.trim() || '';
}

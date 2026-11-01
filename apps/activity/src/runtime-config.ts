function metaClientId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.querySelector('meta[name="crystalaid-client-id"]')?.getAttribute('content') ?? undefined;
}

/**
 * The Discord application id. The API injects it into index.html at runtime, so one build works
 * for any deployment; the build-time VITE_DISCORD_CLIENT_ID is the fallback for the dev server.
 */
export function readClientId(
  runtime: string | undefined = metaClientId(),
  buildTime: string | undefined = import.meta.env.VITE_DISCORD_CLIENT_ID,
): string {
  return runtime?.trim() || buildTime?.trim() || '';
}

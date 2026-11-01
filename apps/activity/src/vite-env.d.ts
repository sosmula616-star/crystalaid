/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application (client) id. The only client-side environment value. */
  readonly VITE_DISCORD_CLIENT_ID: string;
  /** Dev only: `1` runs the fake Discord SDK and API (`pnpm dev:mock`). */
  readonly VITE_DEV_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

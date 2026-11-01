/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application (client) id. The only client-side environment value. */
  readonly VITE_DISCORD_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

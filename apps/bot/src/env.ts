import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/** Loads the repository's `.env`; variables of the real environment win. */
export function loadRootEnvFile(path: string = ROOT_ENV_FILE): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  SERVICE_TOKEN: z.string().min(32),
  REDIS_URL: z.string().min(1),
  /** Base URL of the API; defaults to the local API port. */
  API_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export interface BotEnv {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  SERVICE_TOKEN: string;
  REDIS_URL: string;
  API_URL: string;
}

/** Errors name variables, never values. */
export function loadBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  const r = schema.safeParse(source);
  if (!r.success) {
    const problems = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const { PORT, API_URL, ...rest } = r.data;
  return { ...rest, API_URL: API_URL ?? `http://127.0.0.1:${PORT}` };
}

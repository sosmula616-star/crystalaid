import { isIP } from 'node:net';
import { z } from 'zod';

function isIpOrCidr(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split('/');
  const version = isIP(address ?? '');
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  // Prefix 0 would trust every address, so it is rejected.
  return /^\d{1,3}$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (version === 4 ? 32 : 128);
}

/** Comma-separated IPs or CIDRs; empty means no proxy is trusted. */
const trustedProxies = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((e) => e.trim()).filter((e) => e !== ''))
  .refine((list) => list.every(isIpOrCidr), 'must be a comma-separated list of IP addresses or CIDR ranges');

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_API_URL: z.url().default('https://discord.com/api/v10'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  SERVICE_TOKEN: z.string().min(32),
  TRUSTED_PROXIES: trustedProxies,
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type Env = z.infer<typeof schema>;

/**
 * Parses and validates environment variables. Errors list only variable
 * names and rule messages, never the offending values.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

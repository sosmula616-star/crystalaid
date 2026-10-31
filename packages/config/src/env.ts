import { z } from 'zod';

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_API_URL: z.url().default('https://discord.com/api/v10'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  SERVICE_TOKEN: z.string().min(32),
  TRUST_PROXY_HOPS: z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .default(1),
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

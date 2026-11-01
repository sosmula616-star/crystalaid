import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake id');
const roleList = z.array(snowflake).min(1, 'must contain at least one role id');

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const schema = z
  .object({
    guildId: snowflake,
    timezone: z.string().refine(isValidTimezone, 'must be a valid IANA timezone'),
    roles: z.object({
      support: roleList,
      curator: roleList,
      admin: z.array(snowflake).default([]),
    }),
    users: z
      .object({
        admins: z.array(snowflake).default([]),
        developers: z.array(snowflake).default([]),
      })
      .default({ admins: [], developers: [] }),
    channels: z.object({
      /** Log channel; may be on another server where the bot can write. */
      log: snowflake,
      /** The only channel where `/help` opens a ticket. */
      help: snowflake,
      ticketCategory: snowflake.optional(),
      ticketPanel: snowflake.optional(),
      reports: snowflake.optional(),
      audit: snowflake.optional(),
    }),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const list of [cfg.roles.support, cfg.roles.curator, cfg.roles.admin]) {
      for (const id of new Set(list)) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['roles'],
            message: 'the same role id must not appear in more than one list',
          });
          return;
        }
        seen.add(id);
      }
    }
  });

export type ServerConfig = z.infer<typeof schema>;

const defaultPath = fileURLToPath(new URL('../../../crystalaid.config.json', import.meta.url));

/** Validates a parsed config object. Errors name fields and rules only. */
export function parseServerConfig(raw: unknown, source: string): ServerConfig {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid server config ${source}: ${problems}`);
  }
  return result.data;
}

/** Reads and validates the server config; defaults to crystalaid.config.json in the repo root. */
export function loadServerConfig(path: string = defaultPath): ServerConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read server config file ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Server config file ${path} is not valid JSON`);
  }
  return parseServerConfig(raw, path);
}

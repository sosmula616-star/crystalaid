import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { loadEnv, loadServerConfig, type Env, type ServerConfig } from '@crystalaid/config';
import { createDb, type Db } from '@crystalaid/database';
import { ensureSeeded } from '../services/permissions.js';
import { createDiscordClient, type DiscordClient } from '../discord/client.js';
import { consoleLog, type Logger } from '../log.js';
import { registerAuth } from './auth.js';
import { registerErrorHandling } from './errors.js';
import { registerHealth } from './health.js';
import { registerRateLimit } from './rateLimit.js';
import { registerAudit } from './routes/audit.js';
import { registerInternal } from './routes/internal.js';
import { registerMe } from './routes/me.js';
import { registerPermissions } from './routes/permissions.js';
import { registerSettings } from './routes/settings.js';
import { registerStaff } from './routes/staff.js';
import { registerStatic } from './static.js';

export interface ServerDeps {
  env: Env;
  config: ServerConfig;
  db: Db;
  redis: Redis;
  discord: DiscordClient;
  /** Where Pino writes; stdout when omitted. Tests pass a stream to capture the log. */
  logStream?: Writable;
  /** Serve the built Activity from this directory at `/`; the id goes into index.html. */
  activity?: { dir: string; clientId: string };
}

const SENSITIVE = [
  'authorization',
  'code',
  'access_token',
  'client_secret',
  'sessionToken',
  'discordAccessToken',
];

/**
 * Each name at the top level, one level down and in the request body. `*.code` is left out on
 * purpose: it would also hide `err.code` (ECONNREFUSED and the like); OAuth codes are only ever
 * logged at the top level or under a body.
 */
const REDACT_PATHS = [
  ...SENSITIVE,
  ...SENSITIVE.filter((n) => n !== 'code').map((n) => `*.${n}`),
  ...SENSITIVE.flatMap((n) => [`body.${n}`, `req.body.${n}`]),
  'req.headers.authorization',
  'req.headers.cookie',
];

/** Builds the app. It is not listening or ready yet, so routes can still be added. */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { env, db, redis } = deps;
  const app = Fastify({
    logger: {
      level: 'info',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    // Only peers in TRUSTED_PROXIES may set the client address; for anyone else it is the socket's.
    trustProxy: env.TRUSTED_PROXIES.length > 0 ? env.TRUSTED_PROXIES : false,
    // The id comes from the server only, so a client cannot forge log correlation.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    // Discord's URL Mapping sends `/` here, so the client's `/api/x` arrives as `/api/x`: serve it as `/x`.
    rewriteUrl: (req) => {
      const url = req.url ?? '/';
      if (!/^\/api(?=[/?]|$)/.test(url)) return url;
      const rest = url.slice('/api'.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    },
  });

  registerErrorHandling(app);
  await registerRateLimit(app, redis);
  registerHealth(app, { db, redis });
  registerAuth(app, deps);
  const routeDeps = { db, config: deps.config };
  registerMe(app, routeDeps);
  registerStaff(app, routeDeps);
  registerPermissions(app, routeDeps);
  registerSettings(app, routeDeps);
  registerAudit(app, routeDeps);
  registerInternal(app, { ...routeDeps, redis });
  if (deps.activity) await registerStatic(app, deps.activity);
  return app;
}

export interface ShutdownParts {
  close(): Promise<unknown>;
  quitRedis(): Promise<unknown>;
  endDb(): Promise<unknown>;
}

/** One shutdown: stop accepting requests, then close Redis and the pool. Never rejects. */
export function createShutdown(parts: ShutdownParts, log: Logger): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    running ??= (async () => {
      for (const step of [parts.close, parts.quitRedis, parts.endDb]) {
        try {
          await step();
        } catch (err) {
          log.error('shutdown failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return running;
  };
}

/** Runs the API on PORT until SIGTERM or SIGINT. */
export async function runApi(): Promise<void> {
  const log = consoleLog;
  const env = loadEnv();
  const config = loadServerConfig(process.env.CONFIG_PATH || undefined);
  const db = createDb(env.DATABASE_URL, (err) => log.error('database pool error', { error: err.message }));
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 500 });
  redis.on('error', (err) => log.error('redis error', { error: err.message }));

  await ensureSeeded(db, config.guildId);
  const dist = process.env.ACTIVITY_DIST;
  const app = await buildServer({
    env,
    config,
    db,
    redis,
    discord: createDiscordClient(env, log),
    ...(dist ? { activity: { dir: dist, clientId: env.DISCORD_CLIENT_ID } } : {}),
  });
  const shutdown = createShutdown(
    {
      close: () => app.close(),
      quitRedis: () => redis.quit(),
      endDb: () => db.$client.end(),
    },
    log,
  );
  const stop = () => void shutdown();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info('api started', { port: env.PORT });
  await new Promise<void>((resolve) => app.server.once('close', () => resolve()));
  await shutdown();
}

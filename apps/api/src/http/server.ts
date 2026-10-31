import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { loadEnv, loadServerConfig, type Env, type ServerConfig } from '@crystalaid/config';
import { createDb, type Db } from '@crystalaid/database';
import { createDiscordClient, type DiscordClient } from '../discord/client.js';
import { consoleLog, type Logger } from '../log.js';
import { registerAuth } from './auth.js';
import { registerErrorHandling } from './errors.js';
import { registerHealth } from './health.js';
import { registerRateLimit } from './rateLimit.js';

export interface ServerDeps {
  env: Env;
  config: ServerConfig;
  db: Db;
  redis: Redis;
  discord: DiscordClient;
  /** Where Pino writes; stdout when omitted. Tests pass a stream to capture the log. */
  logStream?: Writable;
}

const SENSITIVE = [
  'authorization',
  'code',
  'access_token',
  'client_secret',
  'sessionToken',
  'discordAccessToken',
];

/** Each name at the top level, one level down, and in the request's headers and body. */
const REDACT_PATHS = [
  ...SENSITIVE,
  ...SENSITIVE.map((n) => `*.${n}`),
  ...SENSITIVE.map((n) => `req.body.${n}`),
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Fastify treats a plain number as "trust nothing" (it cannot check the immediate peer), which
 * would make every client look like the proxy. Trusting the nearest `hops` addresses as proxies
 * makes `request.ip` the address the outermost trusted proxy saw, and ignores anything a client
 * put further left in X-Forwarded-For. Zero hops: use the socket address.
 */
export function trustProxyHops(hops: number): false | ((address: string, index: number) => boolean) {
  return hops > 0 ? (_address, index) => index < hops : false;
}

/** Builds the app. It is not listening or ready yet, so routes can still be added. */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { env, db, redis } = deps;
  const app = Fastify({
    logger: {
      level: 'info',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    trustProxy: trustProxyHops(env.TRUST_PROXY_HOPS),
    // The id comes from the server only, so a client cannot forge log correlation.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  registerErrorHandling(app);
  await registerRateLimit(app, redis);
  registerHealth(app, { db, redis });
  registerAuth(app, deps);
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
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on('error', (err) => log.error('redis error', { error: err.message }));

  const app = await buildServer({ env, config, db, redis, discord: createDiscordClient(env) });
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

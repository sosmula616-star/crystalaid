import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { loadServerConfig, type ServerConfig } from '@crystalaid/config';
import { createDb, type Db } from '@crystalaid/database';
import { consoleLog, type Logger } from '../log.js';
import { consumeBatch } from './consumer.js';

const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface WorkerDeps {
  db: Db;
  redis: Redis;
  config: ServerConfig;
  log: Logger;
  consumer: string;
  blockMs?: number;
}

export interface Worker {
  /** Resolves when the loop has ended and the connections are closed. */
  done: Promise<void>;
  /** Ends the loop after the current batch, then closes Redis and the database pool. Idempotent. */
  stopWorker(): Promise<void>;
}

/** Starts the consume loop. Nothing else is started; callers wire signals to `stopWorker`. */
export function startWorker(deps: WorkerDeps): Worker {
  const { db, redis, log } = deps;
  let stopping = false;

  const done = (async () => {
    while (!stopping) {
      try {
        await consumeBatch(deps, deps.consumer);
      } catch (err) {
        if (stopping) break;
        log.error('consume loop failed', { error: err instanceof Error ? err.message : String(err) });
        await sleep(RETRY_DELAY_MS);
      }
    }
    log.info('worker stopping');
    try {
      await redis.quit();
      // QUIT is acknowledged before the socket closes; wait until the client is really finished.
      if (redis.status !== 'end') await new Promise<void>((resolve) => redis.once('end', () => resolve()));
    } finally {
      await db.$client.end();
    }
  })();

  return {
    done,
    stopWorker: () => {
      stopping = true;
      return done;
    },
  };
}

/** Runs the worker until SIGTERM or SIGINT. CONFIG_PATH may point to the server config file. */
export async function runWorker(): Promise<void> {
  const log = consoleLog;
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL must be set');

  const config = loadServerConfig(process.env.CONFIG_PATH || undefined);
  const db = createDb(databaseUrl, (err) => log.error('database pool error', { error: err.message }));
  const redis = new Redis(redisUrl);
  redis.on('error', (err) => log.error('redis error', { error: err.message }));
  const consumer = `${hostname()}-${process.pid}`;

  const worker = startWorker({ db, redis, config, log, consumer });
  const stop = () =>
    void worker
      .stopWorker()
      .catch((err: unknown) => log.error('worker shutdown failed', { error: err instanceof Error ? err.message : String(err) }));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  log.info('worker started', { consumer });
  await worker.done;
}

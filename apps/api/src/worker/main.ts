import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { loadServerConfig } from '@crystalaid/config';
import { createDb } from '@crystalaid/database';
import { consoleLog as log } from '../log.js';
import { consumeBatch } from './consumer.js';

const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the consume loop until SIGTERM or SIGINT, then closes connections. */
export async function runWorker(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL must be set');

  const config = loadServerConfig();
  const db = createDb(databaseUrl, (err) => log.error('database pool error', { error: err.message }));
  const redis = new Redis(redisUrl);
  redis.on('error', (err) => log.error('redis error', { error: err.message }));
  const consumer = `${hostname()}-${process.pid}`;

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  log.info('worker started', { consumer });
  while (!stopping) {
    try {
      await consumeBatch({ db, redis, config, log }, consumer);
    } catch (err) {
      log.error('consume loop failed', { error: err instanceof Error ? err.message : String(err) });
      await sleep(RETRY_DELAY_MS);
    }
  }
  log.info('worker stopping');
  await redis.quit();
  await db.$client.end();
}

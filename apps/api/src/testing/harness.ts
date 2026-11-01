import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from '@crystalaid/config';
import { withTestDb, type Db } from '@crystalaid/database';
import { createDiscordClient, type DiscordClient } from '../discord/client.js';
import { buildServer } from '../http/server.js';
import { BOT_TOKEN, CLIENT_ID, config, recordingLog, testEnv } from '../test-helpers.js';
import { startFakeDiscord, type FakeDiscord } from './fakeDiscord.js';

export interface AppContext {
  app: FastifyInstance;
  db: Db;
  env: Env;
  fake: FakeDiscord;
  /** Everything the server logged, as one string per line. */
  logs: string[];
}

export interface AppOptions {
  redis: Redis;
  /** The database the server uses, for outage tests. Tests still read through the test database. */
  db?: Db;
  /** Builds the Discord client; by default the real one against the fake. */
  discord?: (env: Env, fake: FakeDiscord) => DiscordClient;
  /** Overrides for the environment, such as TRUSTED_PROXIES. */
  env?: Partial<Env>;
  /** Runs before the server is ready, to add test routes. */
  setup?: (app: FastifyInstance) => void;
  /** Serve a built Activity, as when ACTIVITY_DIST is set. */
  activity?: { dir: string; clientId: string };
}

/** A server wired to the test database, a fake Discord and a log capture. */
export function withApp(options: AppOptions, fn: (ctx: AppContext) => Promise<void>): Promise<void> {
  return withTestDb(async (testDb) => {
    const fake = await startFakeDiscord(BOT_TOKEN, CLIENT_ID);
    const logs: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        logs.push(chunk.toString());
        cb();
      },
    });
    const env = { ...testEnv(fake.url), ...options.env };
    const db = options.db ?? testDb;
    const app = await buildServer({
      env,
      config,
      db,
      redis: options.redis,
      discord: options.discord ? options.discord(env, fake) : createDiscordClient(env, recordingLog()),
      logStream,
      ...(options.activity ? { activity: options.activity } : {}),
    });
    options.setup?.(app);
    try {
      await fn({ app, db: testDb, env, fake, logs });
    } finally {
      await app.close();
      await fake.close();
    }
  });
}


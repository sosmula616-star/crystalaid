import { Redis } from 'ioredis';
import { Events } from 'discord.js';
import { loadServerConfig } from '@crystalaid/config';
import { ApiClient } from './api.js';
import { registerCommands } from './commands.js';
import { assertLogChannel, createClient, createDiscordPort, guildSource, wire, wireResync } from './discord.js';
import { loadBotEnv, loadRootEnvFile } from './env.js';
import { createHandlers } from './handlers.js';
import { createMenu } from './menu.js';
import { createRoster, createSnapshotRunner, snapshotWithRetry } from './roster.js';
import { createScheduler } from './scheduler.js';
import { redisEventSink, redisOfferStore } from './store.js';

const command = process.argv[2];

function fail(err: unknown): never {
  // Only the message: connection strings and tokens never come from here, but keep it short anyway.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
}

async function register(): Promise<void> {
  const env = loadBotEnv();
  const config = loadServerConfig();
  const n = await registerCommands(env.DISCORD_BOT_TOKEN, env.DISCORD_CLIENT_ID, config.guildId);
  console.log(`Registered ${n} guild commands.`);
}

async function start(): Promise<void> {
  const env = loadBotEnv();
  const config = loadServerConfig();
  const redis = new Redis(env.REDIS_URL);
  const roster = createRoster(config, redisEventSink(redis));
  const client = createClient(config, roster.isRelevant);
  const onError = (err: unknown, where: string) => console.error(`[bot] ${where}:`, err);
  const api = new ApiClient(env.API_URL, env.SERVICE_TOKEN);
  const handlers = createHandlers({
    api,
    discord: createDiscordPort(client, config),
    store: redisOfferStore(redis),
    config,
    onError,
  });
  const scheduler = createScheduler({ api, handlers, config, onError });
  const menu = createMenu({
    api,
    config,
    onError,
    tickets: { close: handlers.adminClose, release: handlers.adminRelease },
    botUptimeSeconds: () => Math.floor(process.uptime()),
  });
  wire(client, handlers, roster, onError, menu, config);

  // The roster snapshot is the base the API builds on; it runs at startup, after a lost session and
  // once a day, with retries (the gateway limits member requests).
  const source = guildSource(client, config.guildId, onError);
  const snapshots = createSnapshotRunner({
    run: () =>
      snapshotWithRetry(roster, source, {
        onFail: (err, attempt) => onError(err, `roster snapshot (attempt ${attempt})`),
      }),
    onDone: (n, reason) => console.log(`[bot] roster snapshot published: ${n} members (${reason})`),
    onFail: (err, reason) => {
      onError(err, `roster snapshot (${reason}), giving up until the next run`);
      void handlers.log(
        'Не удалось отправить список участников ветки. Проверьте интент Server Members и повторите запуск, иначе роли не обновятся.',
      );
    },
  });
  let ready = false;
  wireResync(client, snapshots, () => ready);

  client.once(Events.ClientReady, () => {
    console.log(`[bot] logged in as ${client.user?.tag}`);
    assertLogChannel(client, config).then(
      () => {
        ready = true;
        snapshots.trigger('startup');
        snapshots.start();
        scheduler.start();
      },
      fail,
    );
  });
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] ${signal}, shutting down`);
    scheduler.stop();
    snapshots.stop();
    void client.destroy();
    redis.quit().catch(() => redis.disconnect()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await client.login(env.DISCORD_BOT_TOKEN);
}

process.on('unhandledRejection', (err) => console.error('[bot] unhandled rejection:', err));
loadRootEnvFile();

if (command === 'start') start().catch(fail);
else if (command === 'register') register().catch(fail);
else {
  console.error('Usage: main <start|register>');
  process.exit(1);
}

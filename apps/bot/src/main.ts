import { Redis } from 'ioredis';
import { Events } from 'discord.js';
import { loadServerConfig } from '@crystalaid/config';
import { ApiClient } from './api.js';
import { registerCommands } from './commands.js';
import { createClient, createDiscordPort, guildSource, wire } from './discord.js';
import { loadBotEnv, loadRootEnvFile } from './env.js';
import { createHandlers } from './handlers.js';
import { createRoster } from './roster.js';
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
  wire(client, handlers, roster, onError);

  client.once(Events.ClientReady, () => {
    console.log(`[bot] logged in as ${client.user?.tag}`);
    roster
      .snapshot(guildSource(client, config.guildId))
      .then((n) => console.log(`[bot] roster snapshot published: ${n} members`))
      .catch(async (err: unknown) => {
        onError(err, 'roster snapshot');
        await handlers.log('Не удалось отправить список участников ветки при запуске. Проверьте интент Server Members.');
      });
    scheduler.start();
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] ${signal}, shutting down`);
    scheduler.stop();
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

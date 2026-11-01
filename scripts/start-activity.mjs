#!/usr/bin/env node
// One-container launcher for the Activity (bothost.tech): optional local Redis, migrations, then
// the API role, which also serves the built Activity. Plain Node, no dependencies.
//
//   CONFIG_JSON   the server config as JSON; written to a private temp file, CONFIG_PATH points at it
//   REDIS_URL     when unset, a local redis-server on 127.0.0.1 (no persistence) is started
//   ACTIVITY_DIST defaults to apps/activity/dist
//
// Child output is filtered: connection strings and the values of secret variables never reach the log.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tsx = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs');

const STOP_GRACE_MS = 8000; // the whole shutdown stays under 10 s
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const HEALTHY_AFTER_MS = 60000;

const SECRET_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_BOT_TOKEN',
  'JWT_SECRET',
  'SERVICE_TOKEN',
  'CONFIG_JSON',
];
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi;

const log = (message) => console.log(`[launcher] ${message}`);

/** Replaces connection strings and the exact values of secret variables. */
function scrub(line) {
  let out = line.replace(URL_LIKE, '[url]');
  for (const name of SECRET_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out;
}

function pipeScrubbed(stream, sink) {
  createInterface({ input: stream }).on('line', (line) => sink.write(`${scrub(line)}\n`));
}

let stopping = false;
const children = new Set();
let tempDir;

function start(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  pipeScrubbed(child.stdout, process.stdout);
  pipeScrubbed(child.stderr, process.stderr);
  const done = new Promise((resolveDone) => {
    child.once('error', (err) => {
      log(`cannot start ${args[0] ?? command}: ${err.code ?? err.name}`);
      children.delete(child);
      resolveDone({ code: 127, signal: null });
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      resolveDone({ code, signal });
    });
  });
  return { child, done };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sleeps, but wakes early when the launcher is stopping. */
async function pause(ms) {
  const step = 200;
  for (let waited = 0; waited < ms && !stopping; waited += step) await sleep(step);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function redisAnswers(port) {
  return new Promise((resolveOk) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (ok) => {
      socket.destroy();
      resolveOk(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write('PING\r\n'));
    socket.once('data', (data) => finish(data.toString().startsWith('+PONG')));
  });
}

/** Keeps a local redis-server running on `port`, restarting it with backoff. */
function superviseRedis(port) {
  void (async () => {
    let backoff = BACKOFF_START_MS;
    while (!stopping) {
      const startedAt = Date.now();
      const { done } = start('redis-server', [
        '--bind', '127.0.0.1',
        '--port', String(port),
        '--save', '',
        '--appendonly', 'no',
        '--protected-mode', 'yes',
      ]);
      const { code } = await done;
      if (stopping) return;
      backoff = Date.now() - startedAt > HEALTHY_AFTER_MS ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
      log(`redis-server exited (${code}); restarting in ${backoff / 1000}s`);
      await pause(backoff);
    }
  })();
}

async function waitForRedis(port) {
  for (let i = 0; i < 100 && !stopping; i++) {
    if (await redisAnswers(port)) return true;
    await sleep(100);
  }
  return false;
}

function prepareConfig() {
  if (!process.env.CONFIG_JSON) return;
  tempDir = mkdtempSync(join(tmpdir(), `crystalaid-${randomBytes(4).toString('hex')}-`));
  const file = join(tempDir, 'config.json');
  writeFileSync(file, process.env.CONFIG_JSON, { mode: 0o600 });
  process.env.CONFIG_PATH = file;
  log('server config written to a temporary file');
}

function cleanup() {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
}

async function stopAll() {
  if (stopping) return;
  stopping = true;
  log('stopping');
  const running = [...children];
  for (const child of running) child.kill('SIGTERM');
  const exited = Promise.all(running.map((c) => new Promise((r) => (c.exitCode !== null || c.signalCode ? r() : c.once('exit', r)))));
  const timedOut = await Promise.race([exited.then(() => false), sleep(STOP_GRACE_MS).then(() => true)]);
  if (timedOut) {
    log('children did not stop in time; killing');
    for (const child of children) child.kill('SIGKILL');
    await sleep(300);
  }
  cleanup();
  process.exit(0);
}

async function main() {
  process.on('SIGTERM', () => void stopAll());
  process.on('SIGINT', () => void stopAll());
  process.on('exit', cleanup);

  try {
    mkdirSync(tmpdir(), { recursive: true });
    prepareConfig();
  } catch (err) {
    log(`cannot prepare the config file: ${err.code ?? err.name}`);
    process.exit(1);
  }

  if (!process.env.REDIS_URL) {
    const port = await freePort();
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    superviseRedis(port);
    if (!(await waitForRedis(port)) && !stopping) log('local Redis did not answer yet; the API will keep retrying');
    else log('local Redis is up on 127.0.0.1 (no persistence)');
  }
  process.env.ACTIVITY_DIST ||= join(root, 'apps/activity/dist');

  let backoff = BACKOFF_START_MS;
  while (!stopping) {
    const startedAt = Date.now();
    // Migrations the bot already applied are skipped by drizzle (it compares the journal timestamps).
    const migration = await start(process.execPath, [tsx, 'packages/database/src/migrate.ts']).done;
    if (stopping) break;
    let reason = `migrations failed (${migration.code})`;
    if (migration.code === 0) {
      log('migrations done; starting the API');
      const api = await start(process.execPath, [tsx, 'apps/api/src/main.ts', 'api']).done;
      reason = `API exited (${api.code ?? api.signal})`;
    }
    if (stopping) break;
    backoff = Date.now() - startedAt > HEALTHY_AFTER_MS ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS);
    log(`${reason}; retrying in ${backoff / 1000}s`);
    await pause(backoff);
  }
}

main().catch((err) => {
  log(`fatal: ${scrub(String(err?.message ?? err))}`);
  process.exit(1);
});

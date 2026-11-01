import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffMembers, withTestDb } from '@crystalaid/database';
import { runApi } from './http/server.js';
import { runWorker } from './worker/main.js';
import { GUILD, SUPPORT_ROLE, clearOwnedKeys, config, discordId, testRedis } from './test-helpers.js';

const control = testRedis();
beforeEach(() => clearOwnedKeys(control));
afterAll(() => control.quit());

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function until<T>(check: () => Promise<T | undefined | false>, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('entry functions', () => {
  it('start the real api and worker from a temporary config, serve /health, apply an event and shut down', () =>
    withTestDb(async (db) => {
      const dir = mkdtempSync(join(tmpdir(), 'crystalaid-smoke-'));
      const configPath = join(dir, 'crystalaid.config.json');
      writeFileSync(configPath, JSON.stringify(config));
      const port = await freePort();

      const saved = { ...process.env };
      Object.assign(process.env, {
        DISCORD_CLIENT_ID: '300000000000000001',
        DISCORD_CLIENT_SECRET: 'smoke-client-secret',
        DISCORD_BOT_TOKEN: 'smoke-bot-token',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        REDIS_URL: process.env.TEST_REDIS_URL,
        JWT_SECRET: 'smoke-jwt-secret-0123456789abcdef0123',
        SERVICE_TOKEN: 'smoke-service-token-0123456789abcdef',
        TRUSTED_PROXIES: '',
        PORT: String(port),
        CONFIG_PATH: configPath,
      });

      // Capture the signal handlers the entry functions register instead of signalling the test process.
      const handlers: (() => void)[] = [];
      const once = vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
        if (event === 'SIGTERM' || event === 'SIGINT') handlers.push(handler);
        return process;
      }) as typeof process.once);

      // the services log to stdout; keep the test output clean
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const api = runApi();
        const worker = runWorker();
        await until(async () => handlers.length >= 4, 'signal handlers');

        const health = await until(async () => {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          return res.ok ? ((await res.json()) as { status: string }) : undefined;
        }, '/health');
        expect(health.status).toBe('ok');

        // the worker really consumes from the stream
        await control.xadd(
          'events:bot',
          '*',
          'event',
          JSON.stringify({
            type: 'member.updated',
            guildId: GUILD,
            userId: discordId(1),
            username: 'smoke',
            avatar: null,
            roleIds: [SUPPORT_ROLE],
            at: new Date().toISOString(),
          }),
        );
        await until(async () => (await db.select().from(staffMembers)).length === 1, 'the worker to apply the event');

        for (const stop of handlers) stop();
        await Promise.all([api, worker]);
        await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
      } finally {
        once.mockRestore();
        stdout.mockRestore();
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
        rmSync(dir, { recursive: true, force: true });
      }
    }));
});

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from './packages/database/src/migrations.js';

export default async function setup(): Promise<void> {
  const envPath = resolve(import.meta.dirname, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  // Only ever the test database; DATABASE_URL is never touched by tests.
  const testUrl = process.env.TEST_DATABASE_URL;
  if (testUrl) await runMigrations(testUrl);
}

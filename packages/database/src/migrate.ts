import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from './migrations.js';

// CLI: migrates DATABASE_URL, or TEST_DATABASE_URL with --test.
const envPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const name = process.argv.includes('--test') ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
const url = process.env[name];
if (!url) throw new Error(`${name} is not set`);
await runMigrations(url);
console.log(`Migrated ${name}`);

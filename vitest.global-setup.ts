import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default function setup(): void {
  const envPath = resolve(import.meta.dirname, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

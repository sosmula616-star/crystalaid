import { runApi } from './http/server.js';
import { runWorker } from './worker/main.js';

const role = process.argv[2];

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (role === 'worker') {
  runWorker().catch(fail);
} else if (role === 'api') {
  runApi().catch(fail);
} else {
  console.error('Usage: main <worker|api>');
  process.exit(1);
}

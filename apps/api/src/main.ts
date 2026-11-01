import { runApi } from './http/server.js';
import { describeStartupError, loadRootEnvFile } from './startup.js';
import { runWorker } from './worker/main.js';

const role = process.argv[2];

function fail(err: unknown): never {
  for (const line of describeStartupError(err)) console.error(line);
  process.exit(1);
}

// The repository's .env fills in what the real environment does not set.
loadRootEnvFile();

if (role === 'worker') {
  runWorker().catch(fail);
} else if (role === 'api') {
  runApi().catch(fail);
} else {
  console.error('Usage: main <worker|api>');
  process.exit(1);
}

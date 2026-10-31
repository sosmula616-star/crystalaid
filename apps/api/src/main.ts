import { runWorker } from './worker/main.js';

const role = process.argv[2];

if (role === 'worker') {
  runWorker().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else if (role === 'api') {
  console.error('API role is not available yet');
  process.exit(1);
} else {
  console.error('Usage: main <worker|api>');
  process.exit(1);
}

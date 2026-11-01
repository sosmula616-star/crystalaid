import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * Loads the repository's `.env` when it exists. Variables that are already set in the real
 * environment win over the file (Node's `process.loadEnvFile` never overwrites them), so a
 * process manager can still override anything. Returns whether a file was read.
 */
export function loadRootEnvFile(path: string = ROOT_ENV_FILE): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

const MAX_CHAIN = 5;
/** Anything shaped like scheme://..., which covers database and Redis connection strings. */
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi;

const oneLine = (value: string) => value.replace(URL_LIKE, '[url]').replace(/\s+/g, ' ').trim();

function describeOne(err: unknown): string {
  if (!(err instanceof Error)) return oneLine(String(err));
  const code = (err as { code?: unknown }).code;
  const detail = err.message || (typeof code === 'string' ? code : '');
  return oneLine(`${err.name}${detail ? `: ${detail}` : ''}`);
}

/**
 * A startup failure as lines for stderr: the error, then every `cause` and the members of an
 * AggregateError (Node reports a refused connection to `localhost` that way, with an empty
 * message). Connection strings are replaced, so no password can reach the terminal.
 */
export function describeStartupError(err: unknown): string[] {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  const walk = (e: unknown, prefix: string, depth: number): void => {
    if (seen.has(e) || depth > MAX_CHAIN) return;
    seen.add(e);
    lines.push(`${prefix}${describeOne(e)}`);
    if (!(e instanceof Error)) return;
    if (e instanceof AggregateError) for (const inner of e.errors.slice(0, MAX_CHAIN)) walk(inner, `${prefix}  - `, depth + 1);
    if (e.cause !== undefined) walk(e.cause, 'caused by: ', depth + 1);
  };
  walk(err, '', 0);
  return lines;
}

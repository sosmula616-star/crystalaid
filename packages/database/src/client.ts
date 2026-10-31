import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/**
 * An idle pooled connection can drop (server restart, network). pg emits `error` on the pool
 * for that, and an unhandled `error` event would crash the process. The default handler does
 * nothing, so the pool simply discards the connection; pass `onError` to log it.
 */
export function createDb(url: string, onError: (err: Error) => void = () => {}): Db {
  const pool = new pg.Pool({ connectionString: url });
  pool.on('error', onError);
  return drizzle(pool, { schema });
}

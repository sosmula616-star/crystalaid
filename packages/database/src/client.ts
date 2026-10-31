import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

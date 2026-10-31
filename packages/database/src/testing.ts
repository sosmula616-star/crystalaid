import { createDb, type Db } from './client.js';
import { TABLE_NAMES } from './schema.js';

/**
 * Runs `fn` against TEST_DATABASE_URL after emptying every table. No transaction is used
 * because race tests need separate connections. TRUNCATE does the cleanup: the append-only
 * triggers on audit_log and token_ledger are row triggers, which TRUNCATE does not fire,
 * so the production rule stays intact.
 */
export async function withTestDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  }
  const db = createDb(url);
  try {
    await db.$client.query(`TRUNCATE ${TABLE_NAMES.join(', ')} RESTART IDENTITY CASCADE`);
    await fn(db);
  } finally {
    await db.$client.end();
  }
}

/**
 * Drizzle ORM client singleton (PR 1.2).
 *
 * Lambda cold starts must reuse a single Pool + drizzle instance per
 * execution environment (a global), not per-invocation clients —
 * otherwise the Postgres connection pool fills up and the Lambda hangs.
 *
 * The `max: 2` pool setting matches the reserved Lambda concurrency (1)
 * plus a single warm-up slot, which keeps us under the Postgres
 * `max_connections` budget (RISK-W11).
 *
 * Both ORMs coexist during PR 1.1 (setup phase only).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema.js';

interface GlobalWithDb {
  __mercadoExpressDb?: ReturnType<typeof drizzle<typeof schema>>;
  __mercadoExpressPool?: Pool;
}

/**
 * Returns a process-singleton Postgres Pool.
 */
export function getPool(): Pool {
  const g = globalThis as GlobalWithDb;
  if (!g.__mercadoExpressPool) {
    if (!process.env['DATABASE_URL']) {
      throw new Error('DATABASE_URL env var is not configured');
    }
    g.__mercadoExpressPool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
  }
  return g.__mercadoExpressPool;
}

/**
 * Returns a process-singleton Drizzle client backed by the singleton Pool.
 */
export function getDb() {
  const g = globalThis as GlobalWithDb;
  if (!g.__mercadoExpressDb) {
    g.__mercadoExpressDb = drizzle(getPool(), { schema });
  }
  return g.__mercadoExpressDb;
}

export type Db = ReturnType<typeof getDb>;

// Re-export useful types
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

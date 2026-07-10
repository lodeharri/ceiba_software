/**
 * Prisma client singleton (PR 1, design.md §10.2).
 *
 * Lambda cold starts must reuse a single PrismaClient per execution
 * environment (a global), not a per-invocation client — otherwise
 * the connection pool fills up and the Lambda hangs.
 *
 * The `connection_limit = 2` setting matches the reserved Lambda
 * concurrency (1) plus a single warm-up slot, which keeps us under
 * the Postgres `max_connections` budget.
 *
 * PR 2a replaces the PR 1 stub with a real PrismaClient.
 */

import { PrismaClient } from '@prisma/client';
import type { ErrorCodeValue } from '@mercadoexpress/shared';

/**
 * The shape every BC expects from a Prisma client.
 *
 * PR 2a real-client migration: instead of a hand-rolled subset, we
 * expose the real PrismaClient type (with the single `$queryRaw` method
 * signature widened to the runtime overloads Prisma provides). Tests
 * can still pass a real client via the `bootstrap*()` factories without
 * needing `vi.mock` to satisfy this interface.
 */
export type PrismaLike = PrismaClient;

export interface PrismaClientOptions {
  /** Maximum simultaneous Postgres connections. Default 2. */
  connectionLimit?: number;
  /** Log levels to emit. Default ['warn', 'error']. */
  log?: Array<'info' | 'warn' | 'error'>;
}

interface GlobalWithPrisma {
  __mercadoExpressPrisma?: PrismaClient;
}

/**
 * Returns a process-singleton real PrismaClient.
 * The singleton pattern guarantees one client per execution context
 * (warm Lambda keeps the connection pool alive across invocations).
 *
 * DATABASE_URL may carry `?connection_limit=2&sslmode=require` as query
 * params — those are read and appended here so callers don't need to.
 */
export function getPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  const g = globalThis as GlobalWithPrisma;
  if (!g.__mercadoExpressPrisma) {
    const url = process.env['DATABASE_URL'] ?? '';
    const limit = options.connectionLimit ?? 2;
    const dbUrl = url.includes('connection_limit=')
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}&sslmode=require`;
    g.__mercadoExpressPrisma = new PrismaClient({
      log: options.log ?? ['warn', 'error'],
      datasources: { db: { url: dbUrl } },
    });
    // Apply connection pool immediately so the first request is fast.
    g.__mercadoExpressPrisma.$connect();
  }
  return g.__mercadoExpressPrisma;
}

/**
 * Type helper for call sites that need to declare a typed Prisma
 * model without importing the generated client.
 */
export type { ErrorCodeValue };

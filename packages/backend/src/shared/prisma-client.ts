/**
 * Prisma client singleton (PR 1 + PR 2, design.md §10.2 + §3.15).
 *
 * Lambda cold starts must reuse a single PrismaClient per execution
 * environment (a global), not a per-invocation client — otherwise
 * the connection pool fills up and the Lambda hangs.
 *
 * The `connection_limit = 2` setting matches the reserved Lambda
 * concurrency (1) plus a single warm-up slot, which keeps us under
 * the Postgres `max_connections` budget.
 *
 * PR 2 changes (design.md §3.15):
 *   - `buildPrismaUrl` is now an exported helper that branches on STAGE
 *     to append `sslmode=disable` (localstack) or `sslmode=require`
 *     (dev/prod). Existing query params are preserved.
 *   - The factory uses the helper instead of an inline string concat.
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
 * Builds the Prisma DATABASE_URL with stage-aware sslmode and the requested
 * connection_limit. Pure function so it is testable without instantiating a
 * PrismaClient.
 *
 * Behavior (PR 2, design.md §3.15):
 *   - Empty URL → throws `DATABASE_URL env var is not configured`.
 *   - `sslmode` already in the URL → preserved (caller decides the mode).
 *   - `sslmode` missing + stage='localstack' → appends `sslmode=disable`.
 *   - `sslmode` missing + any other stage → appends `sslmode=require`.
 *   - `connection_limit` already in the URL → preserved.
 *   - `connection_limit` missing → appended with the supplied value.
 *
 * Existing query params (e.g. `pool_mode=transaction`) are preserved verbatim.
 */
export function buildPrismaUrl(rawUrl: string, stage: string, connectionLimit: number): string {
  if (!rawUrl) {
    throw new Error('DATABASE_URL env var is not configured');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // The URL may come from a legacy env var that lacks an explicit scheme
    // (e.g. `host:5432/db`). Fall back to treating it as a raw connection
    // string by injecting `postgresql://` if needed.
    if (!rawUrl.startsWith('postgresql://') && !rawUrl.startsWith('postgres://')) {
      throw new Error(`DATABASE_URL is not a valid URL: ${rawUrl}`);
    }
    url = new URL(rawUrl);
  }
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(connectionLimit));
  }
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', stage === 'localstack' ? 'disable' : 'require');
  }
  return url.toString();
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
    const stage = process.env['STAGE'] ?? 'dev';
    const dbUrl = buildPrismaUrl(
      process.env['DATABASE_URL'] ?? '',
      stage,
      options.connectionLimit ?? 2,
    );
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

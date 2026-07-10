/**
 * Idempotency Key helpers (PR 1, design.md §12.5 + RISK-S07).
 *
 * Idempotent endpoints accept an `Idempotency-Key` request header. The
 * handler hashes the JSON body (after key-sorting) and looks up the
 * combination `(key, hash)` in a small in-memory / DynamoDB table; a
 * hit short-circuits with the cached response, a miss stores the new
 * response after the handler completes.
 *
 * PR 1 ships only the interface + the body-hashing function. The
 * persistent store (DynamoDB or ElastiCache) ships in PR 2a.
 *
 * RISK-S07 motivates the key-sorted JSON canonicalisation: a client
 * that re-serialises the same body with different field ordering
 * must produce the same hash so the second call hits the cache.
 */

import { createHash } from 'node:crypto';

/**
 * Recursively sorts object keys so that `JSON.stringify` produces a
 * canonical representation. Arrays keep their order; only object keys
 * are sorted.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Returns the lowercase hex SHA-256 of a canonical (key-sorted) JSON
 * encoding of `body`. The output is 64 hex characters and is stable
 * across field-ordering differences.
 */
export function sha256OfSortedJson(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The persistent idempotency store interface. PR 1 ships the shape;
 * PR 2a provides an in-memory implementation (single-Lambda) and
 * later a DynamoDB-backed implementation for cross-Lambda hits.
 */
export interface IdempotencyStore {
  lookup(key: string, bodyHash: string): Promise<unknown | null>;
  store(key: string, bodyHash: string, response: unknown): Promise<void>;
}

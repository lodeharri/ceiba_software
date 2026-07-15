/**
 * DrizzleIdempotencyStoreAdapter — Drizzle-backed implementation of
 * `IdempotencyStore` (KL-11, RISK-W05 follow-up).
 *
 * The interface (`IdempotencyStore`) and the body-hashing helper
 * (`sha256OfSortedJson`) ship in `packages/backend/src/shared/idempotency-key.ts`.
 * The `idempotency_keys` table ships in the Drizzle schema.
 *
 * ## Response shape contract
 *
 * The `IdempotencyStore` interface passes `response: unknown` through
 * `store()`. To keep the adapter aligned with the schema (which has
 * `response_status: Int` + `response_body: Json` + `user_id: NOT NULL`),
 * the caller MUST pass a `StoredResponse` object as the `response`
 * argument.
 *
 * ## Hash mismatch
 *
 * Per spec: same key + different body → `409 IDEMPOTENCY_KEY_CONFLICT`.
 * The adapter surfaces a hash mismatch by returning `null` from `lookup()`,
 * leaving the caller free to distinguish cache miss from cache conflict.
 */

import { eq } from 'drizzle-orm';
import type { IdempotencyStore } from '../../shared/idempotency-key.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

/**
 * Shape the caller passes as the `response` argument to `store()` and
 * receives back from `lookup()` on a cache hit.
 */
export interface StoredResponse {
  status: number;
  body: unknown;
  userId: string;
}

function rowToResponse(row: typeof schema.idempotencyKeys.$inferSelect): StoredResponse {
  return {
    status: row.responseStatus,
    body: row.responseBody as Record<string, unknown>,
    userId: row.userId,
  };
}

export class DrizzleIdempotencyStoreAdapter implements IdempotencyStore {
  constructor(private readonly db = getDb()) {}

  async lookup(key: string, bodyHash: string): Promise<unknown | null> {
    const [row] = await this.db
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.key, key))
      .limit(1);
    if (!row) return null;
    // Hash mismatch = conflict (caller decides between replay and 409).
    if (row.requestHash !== bodyHash) return null;
    return rowToResponse(row);
  }

  async store(key: string, bodyHash: string, response: unknown): Promise<void> {
    const stored = response as StoredResponse;
    await this.db
      .insert(schema.idempotencyKeys)
      .values({
        key,
        userId: stored.userId,
        requestHash: bodyHash,
        responseStatus: stored.status,
        responseBody: stored.body as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: schema.idempotencyKeys.key,
        set: {
          requestHash: bodyHash,
          responseStatus: stored.status,
          responseBody: stored.body as Record<string, unknown>,
        },
      });
  }
}

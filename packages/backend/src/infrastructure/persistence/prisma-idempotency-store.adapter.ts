/**
 * PrismaIdempotencyStoreAdapter — Prisma-backed implementation of
 * `IdempotencyStore` (KL-11, RISK-W05 follow-up).
 *
 * The interface (`IdempotencyStore`) and the body-hashing helper
 * (`sha256OfSortedJson`) ship in `packages/backend/src/shared/idempotency-key.ts`
 * (PR 1). The `idempotency_keys` table ships in the PR 2a migration.
 * This adapter closes the read/write seam that PR 2c / PR 4 rely on.
 *
 * ## Response shape contract
 *
 * The `IdempotencyStore` interface passes `response: unknown` through
 * `store()`. To keep the adapter aligned with the schema (which has
 * `response_status: Int` + `response_body: Json` + `user_id: NOT NULL`),
 * the caller MUST pass a `StoredResponse` object as the `response`
 * argument:
 *
 * ```ts
 *   { status: number, body: unknown, userId: string }
 * ```
 *
 * The adapter splits `status` → `response_status`, `body` → `response_body`,
 * and `userId` → `user_id`. `lookup()` reconstructs the same shape on read.
 *
 * ## TTL policy
 *
 * The schema does not store a TTL column. The 24-hour policy from
 * `specs/shared/spec.md §"Idempotency-Key on write endpoints"` is enforced
 * by the caller (handlers check `createdAt + 24h > now()` before honoring
 * cache hits). The adapter persists whatever the caller passes — including
 * re-`store`s, which upsert and overwrite the previous row.
 *
 * ## Hash mismatch
 *
 * Per spec: same key + different body → `409 IDEMPOTENCY_KEY_CONFLICT`.
 * That semantic is owned by the caller. The adapter surfaces a hash
 * mismatch by returning `null` from `lookup()`, leaving the caller free
 * to distinguish cache miss from cache conflict.
 */

import type { IdempotencyStore } from '../../shared/idempotency-key.js';

/** Row shape returned by the `idempotencyKey` Prisma model. */
export interface IdempotencyKeyRow {
  key: string;
  userId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
}

/** Minimal Prisma surface the adapter relies on. */
export interface IdempotencyPrisma {
  idempotencyKey: {
    findUnique(args: { where: { key: string } }): Promise<IdempotencyKeyRow | null>;
    upsert(args: {
      where: { key: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<IdempotencyKeyRow>;
  };
}

/**
 * Shape the caller passes as the `response` argument to `store()` and
 * receives back from `lookup()` on a cache hit.
 */
export interface StoredResponse {
  status: number;
  body: unknown;
  userId: string;
}

function rowToResponse(row: IdempotencyKeyRow): StoredResponse {
  return {
    status: row.responseStatus,
    body: row.responseBody,
    userId: row.userId,
  };
}

export class PrismaIdempotencyStoreAdapter implements IdempotencyStore {
  constructor(private readonly prisma: IdempotencyPrisma) {}

  async lookup(key: string, bodyHash: string): Promise<unknown | null> {
    const row = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (row === null) return null;
    // Hash mismatch = conflict (caller decides between replay and 409).
    if (row.requestHash !== bodyHash) return null;
    return rowToResponse(row);
  }

  async store(key: string, bodyHash: string, response: unknown): Promise<void> {
    const stored = response as StoredResponse;
    await this.prisma.idempotencyKey.upsert({
      where: { key },
      create: {
        key,
        user_id: stored.userId,
        request_hash: bodyHash,
        response_status: stored.status,
        response_body: stored.body as Record<string, unknown>,
      },
      update: {
        request_hash: bodyHash,
        response_status: stored.status,
        response_body: stored.body as Record<string, unknown>,
      },
    });
  }
}

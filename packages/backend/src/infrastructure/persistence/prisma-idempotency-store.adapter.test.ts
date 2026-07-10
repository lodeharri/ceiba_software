/**
 * RED-first test for `PrismaIdempotencyStoreAdapter` (KL-11, RISK-W05).
 *
 * The interface (`IdempotencyStore` in `src/shared/idempotency-key.ts`)
 * ships in PR 1; the `idempotency_keys` table ships in PR 2a. This test
 * locks the read/write seam that PR 2c / PR 4 rely on.
 *
 * Asserts:
 *   - `lookup` returns null when no row exists for the key.
 *   - `store` persists via Prisma `upsert` with the schema-mapped columns.
 *   - Replay: after `store`, a subsequent `lookup` returns the stored
 *     response (the persisted object reconstructed from `response_status`
 *     + `response_body`).
 *
 * Response shape contract (documented on the adapter):
 *   The caller passes `{ status: number, body: unknown, userId: string }`
 *   as the `response` argument. The adapter splits it into the
 *   `response_status` (Int) and `response_body` (Json) columns; the
 *   `userId` is required by the schema (NOT NULL). Hash mismatch is
 *   handled by the caller — out of scope here.
 */

import { describe, expect, it } from 'vitest';
import {
  PrismaIdempotencyStoreAdapter,
  type IdempotencyKeyRow,
  type IdempotencyPrisma,
  type StoredResponse,
} from './prisma-idempotency-store.adapter.js';

const K = 'idemp-uuid-aaaa';
const H = 'a'.repeat(64);
const U = '11111111-1111-1111-1111-111111111111';

const RESP: StoredResponse = {
  status: 201,
  body: { id: 'product-abc' },
  userId: U,
};

function makeRow(overrides: Partial<IdempotencyKeyRow> = {}): IdempotencyKeyRow {
  return {
    key: K,
    userId: U,
    requestHash: H,
    responseStatus: 201,
    responseBody: { id: 'product-abc' },
    createdAt: new Date('2026-07-10T12:00:00Z'),
    ...overrides,
  };
}

describe('PrismaIdempotencyStoreAdapter', () => {
  it('lookup: returns null when no row exists for the key', async () => {
    let upsertCalls = 0;
    const mockPrisma: IdempotencyPrisma = {
      idempotencyKey: {
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async upsert() {
          upsertCalls += 1;
          throw new Error('upsert must not be called on lookup');
        },
      },
    };
    const adapter = new PrismaIdempotencyStoreAdapter(mockPrisma);

    const result = await adapter.lookup(K, H);

    expect(result).toBeNull();
    expect(upsertCalls).toBe(0);
  });

  it('store: persists via upsert with key, hash, userId, status, body', async () => {
    let captured: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    } | null = null;

    const mockPrisma: IdempotencyPrisma = {
      idempotencyKey: {
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async upsert(args) {
          captured = args;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return makeRow() as any;
        },
      },
    };
    const adapter = new PrismaIdempotencyStoreAdapter(mockPrisma);

    await adapter.store(K, H, RESP);

    expect(captured).not.toBeNull();
    expect(captured!.where).toEqual({ key: K });
    expect(captured!.create).toMatchObject({
      key: K,
      user_id: U,
      request_hash: H,
      response_status: 201,
      response_body: { id: 'product-abc' },
    });
    // The update path overwrites the mutable response fields; key is identity.
    expect(captured!.update).toMatchObject({
      request_hash: H,
      response_status: 201,
      response_body: { id: 'product-abc' },
    });
    expect((captured!.update as Record<string, unknown>).key).toBeUndefined();
  });

  it('replay: lookup returns the previously stored response', async () => {
    const rows = new Map<string, IdempotencyKeyRow>();

    const mockPrisma: IdempotencyPrisma = {
      idempotencyKey: {
        async findUnique(args) {
          const key = args.where.key;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (rows.get(key) as any) ?? null;
        },
        async upsert(args) {
          const c = args.create as {
            key: string;
            user_id: string;
            request_hash: string;
            response_status: number;
            response_body: unknown;
          };
          const row: IdempotencyKeyRow = {
            key: c.key,
            userId: c.user_id,
            requestHash: c.request_hash,
            responseStatus: c.response_status,
            responseBody: c.response_body,
            createdAt: new Date(),
          };
          rows.set(args.where.key, row);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return row as any;
        },
      },
    };
    const adapter = new PrismaIdempotencyStoreAdapter(mockPrisma);

    // First lookup: cache miss.
    const first = await adapter.lookup(K, H);
    expect(first).toBeNull();

    // First save.
    await adapter.store(K, H, RESP);

    // Replay: lookup returns the previous response.
    const replay = await adapter.lookup(K, H);
    expect(replay).toEqual(RESP);
  });
});

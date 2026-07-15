import { describe, expect, it, vi } from 'vitest';
import {
  DrizzleIdempotencyStoreAdapter,
  type StoredResponse,
} from './drizzle-idempotency-store.adapter.js';

function createDbStub() {
  let storedKey: Record<string, unknown> | null = null;

  return {
    _getStored: () => storedKey,
    _setStored(row: Record<string, unknown> | null) {
      storedKey = row;
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(storedKey ? [storedKey] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          target: vi.fn(() => ({
            set: vi.fn(() => Promise.resolve()),
          })),
        })),
      })),
    })),
  };
}

describe('DrizzleIdempotencyStoreAdapter', () => {
  it('lookup returns null when key is not found', async () => {
    const db = createDbStub();
    const adapter = new DrizzleIdempotencyStoreAdapter(db as never);
    const result = await adapter.lookup('unknown-key', 'somehash');
    expect(result).toBeNull();
  });

  it('lookup returns stored response on cache hit with matching hash', async () => {
    const db = createDbStub();
    const stored: StoredResponse = {
      status: 200,
      body: { orderId: '123' },
      userId: 'user-1',
    };
    db._setStored({
      key: 'my-key',
      userId: 'user-1',
      requestHash: 'matching-hash',
      responseStatus: 200,
      responseBody: stored.body,
      createdAt: new Date(),
    });

    const adapter = new DrizzleIdempotencyStoreAdapter(db as never);
    const result = await adapter.lookup('my-key', 'matching-hash');

    expect(result).not.toBeNull();
    const resp = result as StoredResponse;
    expect(resp.status).toBe(200);
  });

  it('lookup returns null on hash mismatch (conflict)', async () => {
    const db = createDbStub();
    db._setStored({
      key: 'my-key',
      userId: 'user-1',
      requestHash: 'original-hash',
      responseStatus: 200,
      responseBody: {},
      createdAt: new Date(),
    });

    const adapter = new DrizzleIdempotencyStoreAdapter(db as never);
    const result = await adapter.lookup('my-key', 'different-hash');

    expect(result).toBeNull();
  });

  it('store inserts a new idempotency key row', async () => {
    const db = createDbStub();
    const adapter = new DrizzleIdempotencyStoreAdapter(db as never);
    await adapter.store('new-key', 'hash123', {
      status: 201,
      body: { created: true },
      userId: 'user-2',
    });

    expect(db.insert).toHaveBeenCalledOnce();
  });
});

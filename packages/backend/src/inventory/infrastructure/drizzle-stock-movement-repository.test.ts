import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DrizzleStockMovementRepository } from './drizzle-stock-movement-repository.js';

function createDbStub() {
  const rows: Array<{
    id: string;
    productId: string;
    type: string;
    quantity: number;
    reason: string;
    userId: string;
    stockAfter: number;
    createdAt: Date;
  }> = [];

  // Build the chain: select().from().where() → { orderBy, limit, offset }
  const whereChain = {
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({
        offset: vi.fn(() => Promise.resolve(rows.slice())),
      })),
    })),
    limit: vi.fn(() => Promise.resolve([{ count: rows.length }])),
  };

  return {
    _setRows(data: typeof rows) {
      rows.length = 0;
      rows.push(...data);
    },
    _getRows: () => rows,
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => whereChain),
      })),
    })),
  };
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('DrizzleStockMovementRepository (inventory BC — infrastructure)', () => {
  let db: ReturnType<typeof createDbStub>;

  beforeEach(() => {
    db = createDbStub();
  });

  describe('append (BR-6: append-only)', () => {
    it('inserts a stock movement row', async () => {
      const repo = new DrizzleStockMovementRepository(db as never);
      await repo.append({
        id: 'a1a1a1a1-1111-4111-8111-111111111111',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 10,
        reason: 'Reposición',
        userId: USER_ID,
        stockAfter: 25,
        createdAt: new Date('2026-07-09T10:00:00Z'),
      });

      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('does NOT expose update or delete methods (BR-6)', () => {
      const repo = new DrizzleStockMovementRepository(db as never);
      expect('update' in repo).toBe(false);
      expect('delete' in repo).toBe(false);
    });
  });

  describe('listByProduct', () => {
    it('returns movements for a given product', async () => {
      const rows = [
        {
          id: 'b1b1b1b1-1111-4111-8111-111111111111',
          productId: PRODUCT_ID,
          type: 'ENTRADA',
          quantity: 10,
          reason: 'First',
          userId: USER_ID,
          stockAfter: 10,
          createdAt: new Date('2026-07-09T10:00:00Z'),
        },
      ];
      db._setRows(rows);

      const repo = new DrizzleStockMovementRepository(db as never);
      const result = await repo.listByProduct({ productId: PRODUCT_ID, page: 1, size: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.reason).toBe('First');
    });

    it('returns empty list for a product with no movements', async () => {
      db._setRows([]);

      const repo = new DrizzleStockMovementRepository(db as never);
      const result = await repo.listByProduct({
        productId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        page: 1,
        size: 10,
      });

      expect(result.items).toHaveLength(0);
    });
  });
});

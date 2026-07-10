import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaStockMovementRepository } from './prisma-stock-movement-repository.js';

// Minimal Prisma surface matching what the repository uses
function createPrismaStub() {
  const rows: Array<{
    id: string;
    productId: string;
    type: string;
    quantity: number;
    reason: string;
    userId: string;
    createdAt: Date;
  }> = [];

  return {
    _setData(
      data: Array<{
        id: string;
        productId: string;
        type: string;
        quantity: number;
        reason: string;
        userId: string;
        createdAt: Date;
      }>,
    ) {
      rows.length = 0;
      rows.push(...data);
    },
    _getRows: () => rows,
    stockMovement: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        rows.push(args.data as (typeof rows)[0]);
        return args.data;
      }),
      findMany: vi.fn(
        async (args: {
          where: { productId: string };
          orderBy: { createdAt: 'desc' | 'asc' };
          skip: number;
          take: number;
        }) => {
          const filtered = rows.filter((r) => r.productId === args.where.productId);
          const sorted = [...filtered].sort((a, b) =>
            args.orderBy.createdAt === 'desc'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          );
          return sorted.slice(args.skip, args.skip + args.take);
        },
      ),
      count: vi.fn(async (args: { where: { productId: string } }) => {
        return rows.filter((r) => r.productId === args.where.productId).length;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('PrismaStockMovementRepository (inventory BC — infrastructure)', () => {
  let prisma: ReturnType<typeof createPrismaStub>;

  beforeEach(() => {
    prisma = createPrismaStub();
  });

  describe('append (BR-6: append-only)', () => {
    it('inserts a stock movement row', async () => {
      const repo = new PrismaStockMovementRepository(prisma);
      await repo.append({
        id: 'a1a1a1a1-1111-4111-8111-111111111111',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 10,
        reason: 'Reposición',
        userId: USER_ID,
        createdAt: new Date('2026-07-09T10:00:00Z'),
      });

      expect(prisma.stockMovement.create).toHaveBeenCalledOnce();
    });

    it('does NOT expose update or delete methods (BR-6)', () => {
      const repo = new PrismaStockMovementRepository(prisma);
      expect('update' in repo).toBe(false);
      expect('delete' in repo).toBe(false);
    });
  });

  describe('listByProduct', () => {
    it('returns movements for a given product ordered by createdAt DESC', async () => {
      const repo = new PrismaStockMovementRepository(prisma);
      const now = new Date();
      const earlier = new Date(now.getTime() - 60000);
      const later = new Date(now.getTime() + 60000);

      // Insert two movements for the product
      await repo.append({
        id: 'b1b1b1b1-1111-4111-8111-111111111111',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 10,
        reason: 'First',
        userId: USER_ID,
        createdAt: earlier,
      });
      await repo.append({
        id: 'c1c1c1c1-1111-4111-8111-111111111111',
        productId: PRODUCT_ID,
        type: 'SALIDA',
        quantity: 3,
        reason: 'Second',
        userId: USER_ID,
        createdAt: later,
      });

      const result = await repo.listByProduct({ productId: PRODUCT_ID, page: 1, size: 10 });

      expect(result.items).toHaveLength(2);
      // Ordered by createdAt DESC: later first, earlier second
      expect(result.items[0]?.reason).toBe('Second');
      expect(result.items[1]?.reason).toBe('First');
      expect(result.total).toBe(2);
    });

    it('paginates correctly with page and size', async () => {
      const repo = new PrismaStockMovementRepository(prisma);
      const base = new Date('2026-07-09T10:00:00Z');

      // Insert 5 movements
      for (let i = 1; i <= 5; i++) {
        await repo.append({
          id: `d${i}0000000-1111-4111-8111-111111111111`.padEnd(36, '0').slice(0, 36),
          productId: PRODUCT_ID,
          type: 'ENTRADA',
          quantity: i,
          reason: `Movement ${i}`,
          userId: USER_ID,
          createdAt: new Date(base.getTime() + i * 60000),
        });
      }

      // Page 1, size 2
      const page1 = await repo.listByProduct({ productId: PRODUCT_ID, page: 1, size: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      // Page 3, size 2 (last page with 1 item)
      const page3 = await repo.listByProduct({ productId: PRODUCT_ID, page: 3, size: 2 });
      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);

      // Page out of range
      const page4 = await repo.listByProduct({ productId: PRODUCT_ID, page: 10, size: 2 });
      expect(page4.items).toHaveLength(0);
      expect(page4.hasMore).toBe(false);
    });

    it('returns empty list for a product with no movements', async () => {
      const repo = new PrismaStockMovementRepository(prisma);
      const result = await repo.listByProduct({
        productId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        page: 1,
        size: 10,
      });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('includes hasMore in the page envelope', async () => {
      const repo = new PrismaStockMovementRepository(prisma);
      const base = new Date('2026-07-09T10:00:00Z');

      for (let i = 1; i <= 3; i++) {
        await repo.append({
          id: `e${i}0000000-1111-4111-8111-111111111111`.padEnd(36, '0').slice(0, 36),
          productId: PRODUCT_ID,
          type: 'ENTRADA',
          quantity: i,
          reason: `Item ${i}`,
          userId: USER_ID,
          createdAt: new Date(base.getTime() + i * 60000),
        });
      }

      const page1 = await repo.listByProduct({ productId: PRODUCT_ID, page: 1, size: 2 });
      expect(page1.hasMore).toBe(true);
      expect(page1.items).toHaveLength(2);

      const page2 = await repo.listByProduct({ productId: PRODUCT_ID, page: 2, size: 2 });
      expect(page2.hasMore).toBe(false);
      expect(page2.items).toHaveLength(1);
    });
  });
});

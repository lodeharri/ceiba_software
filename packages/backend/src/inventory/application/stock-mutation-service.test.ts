import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StockMutationService } from './stock-mutation-service.js';
import type { AlertCloserPort } from '../../alerts/domain/ports/alert-closer-port.js';
import { StockWouldGoNegativeError } from '../domain/errors/stock-would-go-negative.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';

// ─── Stub Prisma client ─────────────────────────────────────────────
function createStubPrisma() {
  let stockRows: Array<{ id: string; stock: number; stock_min: number }> = [];
  const createdMovements: unknown[] = [];
  const updatedProducts: unknown[] = [];
  const createdAlerts: unknown[] = [];
  const txQueryRawCalls: unknown[][] = [];

  return {
    _setStock(rows: Array<{ id: string; stock: number; stock_min: number }>) {
      stockRows = rows;
    },
    _getCreatedMovements: () => createdMovements,
    _getUpdatedProducts: () => updatedProducts,
    _getCreatedAlerts: () => createdAlerts,
    _getTxQueryRawCalls: () => txQueryRawCalls,
    $queryRaw: vi.fn(async () => stockRows),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txMovements: unknown[] = [];
      const txProducts: unknown[] = [];
      const txAlerts: unknown[] = [];

      const tx = {
        $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          txQueryRawCalls.push({ strings: [...strings], values });
          return stockRows;
        }),
        stockMovement: {
          create: vi.fn(async (args: unknown) => {
            txMovements.push(args);
            return args;
          }),
        },
        product: {
          update: vi.fn(async (args: unknown) => {
            txProducts.push(args);
            return args;
          }),
        },
        alert: {
          create: vi.fn(async (args: unknown) => {
            txAlerts.push(args);
            return args;
          }),
          findFirst: vi.fn(async () => null),
        },
      };

      // If fn(tx) throws, the push statements below are never reached,
      // which simulates a rollback (no mutation persisted).
      const result = await fn(tx);
      createdMovements.push(...txMovements);
      updatedProducts.push(...txProducts);
      createdAlerts.push(...txAlerts);
      return result;
    }),
  };
}

// ─── Stub AlertCloserPort ────────────────────────────────────────────
function createStubAlertCloser(overrides?: {
  result?: { alertId: string } | null;
  shouldThrow?: Error;
}) {
  if (overrides?.shouldThrow) {
    return {
      txCloseIfOpenAndAboveMin: vi.fn(async () => {
        throw overrides.shouldThrow;
      }),
    } satisfies AlertCloserPort;
  }
  return {
    txCloseIfOpenAndAboveMin: vi.fn(async () => overrides?.result ?? null),
  } satisfies AlertCloserPort;
}

describe('StockMutationService (inventory BC — application)', () => {
  let stubPrisma: ReturnType<typeof createStubPrisma>;
  let stubAlertCloser: AlertCloserPort;

  beforeEach(() => {
    stubPrisma = createStubPrisma();
    stubAlertCloser = createStubAlertCloser();
  });

  describe('ENTRADA happy path (Task 4)', () => {
    it('inserts movement + updates stock; returns stockAfter', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 5 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      const result = await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición proveedor',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(result.stockAfter).toBe(15);
      expect(stubPrisma._getCreatedMovements()).toHaveLength(1);
      expect(stubPrisma._getUpdatedProducts()).toHaveLength(1);

      // The StockMovement row must persist stockAfter at insert time so
      // list views do not need to walk the ledger to compute it.
      const movement = stubPrisma._getCreatedMovements()[0] as {
        data: { stockAfter: number };
      };
      expect(movement.data.stockAfter).toBe(15);
    });

    it('calls SELECT ... FOR UPDATE with correct SQL', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 5 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      // The tx.$queryRaw should be called with the FOR UPDATE SQL
      const calls = stubPrisma._getTxQueryRawCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const firstCall = calls[0] as { strings: string[] };
      expect(firstCall.strings.join('')).toContain('FOR UPDATE');
    });
  });

  describe('SALIDA below zero — STOCK_WOULD_GO_NEGATIVE (Task 4)', () => {
    it('throws StockWouldGoNegativeError with correct details', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 3 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await expect(
        service.record({
          productId: '11111111-1111-4111-8111-111111111111',
          type: 'SALIDA',
          quantity: 15,
          reason: 'Venta grande',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).rejects.toThrow(StockWouldGoNegativeError);

      // No movement row created on rejection (tx rolled back)
      expect(stubPrisma._getCreatedMovements()).toHaveLength(0);
      expect(stubPrisma._getUpdatedProducts()).toHaveLength(0);
    });

    it('error has correct details: currentStock, requested, shortBy', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 3 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      try {
        await service.record({
          productId: '11111111-1111-4111-8111-111111111111',
          type: 'SALIDA',
          quantity: 15,
          reason: 'Venta grande',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StockWouldGoNegativeError);
        expect((err as StockWouldGoNegativeError).details).toEqual({
          currentStock: 10,
          requested: 15,
          shortBy: 5,
        });
      }
    });
  });

  describe('Unknown product (Task 4)', () => {
    it('throws ProductNotFoundError when product row not found', async () => {
      stubPrisma._setStock([]); // no rows returned

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await expect(
        service.record({
          productId: 'nonexistent-0000-0000-0000-000000000000',
          type: 'ENTRADA',
          quantity: 5,
          reason: 'Test',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).rejects.toThrow(ProductNotFoundError);
    });
  });

  describe('Recovery path — crossing stock > stockMin calls AlertCloserPort (Task 8)', () => {
    it('calls AlertCloserPort.txCloseIfOpenAndAboveMin when newStock > stockMin', async () => {
      // Scenario: stock = 30, stockMin = 30 (alert active), ENTRADA 5 → stock = 35 > stockMin
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 30, stock_min: 30 },
      ]);
      stubAlertCloser = createStubAlertCloser({ result: { alertId: 'alert-closed-1' } });

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      const result = await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición recovery',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(result.stockAfter).toBe(35);
      expect(stubAlertCloser.txCloseIfOpenAndAboveMin).toHaveBeenCalledOnce();
      expect(stubAlertCloser.txCloseIfOpenAndAboveMin).toHaveBeenCalledWith(expect.anything(), {
        productId: '11111111-1111-4111-8111-111111111111',
        newStock: 35,
        stockMin: 30,
      });
    });

    it('does NOT call AlertCloserPort when newStock <= stockMin', async () => {
      // Scenario: stock = 10, stockMin = 30, SALIDA 5 → stock = 5 <= stockMin
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 30 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 5,
        reason: 'Baja stock',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(stubAlertCloser.txCloseIfOpenAndAboveMin).not.toHaveBeenCalled();
    });
  });

  describe('Failure-rollback — AlertCloserPort throws, entire tx rolls back (Task 9)', () => {
    it('rolls back entire tx when AlertCloserPort throws after movement insert', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 30, stock_min: 30 },
      ]);

      const closerError = new Error('Alert closer failed');
      const failingCloser = createStubAlertCloser({ shouldThrow: closerError });

      const service = new StockMutationService(stubPrisma as never, failingCloser);

      await expect(
        service.record({
          productId: '11111111-1111-4111-8111-111111111111',
          type: 'ENTRADA',
          quantity: 5,
          reason: 'Recovery that fails',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).rejects.toThrow('Alert closer failed');

      // The tx function threw, so no movement was persisted (tx rolled back)
      expect(stubPrisma._getCreatedMovements()).toHaveLength(0);
    });
  });

  describe('Low stock alert creation — crossing below min creates alert (Task 4)', () => {
    it('creates ACTIVA alert when newStock <= stockMin and no existing active alert', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 31, stock_min: 30 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 1,
        reason: 'Baja a minimo',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(stubPrisma._getCreatedAlerts()).toHaveLength(1);
      const alert = stubPrisma._getCreatedAlerts()[0] as { data: { status: string } };
      expect(alert.data.status).toBe('ACTIVA');
    });
  });

  describe('SALIDA exactly to zero succeeds', () => {
    it('accepts SALIDA that brings stock exactly to 0', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 3 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      const result = await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 10,
        reason: 'Venta total',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(result.stockAfter).toBe(0);
    });
  });

  describe('stockAfter persistence (shared/movement.ts contract)', () => {
    it('persists the denormalized stockAfter on SALIDA exactly to zero', async () => {
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 3 },
      ]);

      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 10,
        reason: 'Venta total',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      const movement = stubPrisma._getCreatedMovements()[0] as {
        data: { stockAfter: number };
      };
      expect(movement.data.stockAfter).toBe(0);
    });

    it('persists stockAfter across a sequence of mixed movements', async () => {
      // Simulates the ledger walk the list view used to need: each new
      // movement carries its post-mutation stock, so listByProduct can
      // return the field directly without recomputing. Between calls we
      // bump `_setStock` to mirror the database state after each tx.
      const service = new StockMutationService(stubPrisma as never, stubAlertCloser);

      // 1st movement: ENTRADA 5 with stock=10 → stockAfter = 15
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stock_min: 3 },
      ]);
      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición 1',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      // 2nd movement: SALIDA 3 with stock=15 → stockAfter = 12
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 15, stock_min: 3 },
      ]);
      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 3,
        reason: 'Venta 1',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      // 3rd movement: SALIDA 12 with stock=12 → stockAfter = 0
      stubPrisma._setStock([
        { id: '11111111-1111-4111-8111-111111111111', stock: 12, stock_min: 3 },
      ]);
      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'SALIDA',
        quantity: 12,
        reason: 'Venta total',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      const movements = stubPrisma._getCreatedMovements() as Array<{
        data: { stockAfter: number };
      }>;
      expect(movements).toHaveLength(3);
      expect(movements[0]!.data.stockAfter).toBe(15);
      expect(movements[1]!.data.stockAfter).toBe(12);
      expect(movements[2]!.data.stockAfter).toBe(0);
    });
  });
});

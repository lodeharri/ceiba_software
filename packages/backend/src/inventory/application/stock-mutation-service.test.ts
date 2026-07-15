/**
 * Tests for StockMutationService (PR 1.2 — Drizzle migration).
 *
 * The service now uses UnitOfWork instead of raw Drizzle db.transaction.
 * These tests use a stub UnitOfWork + stub TransactionContext.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StockMutationService } from './stock-mutation-service.js';
import type { AlertCloserPort } from '../../alerts/domain/ports/alert-closer-port.js';
import { StockWouldGoNegativeError } from '../domain/errors/stock-would-go-negative.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';

interface StockRow {
  id: string;
  stock: number;
  stockMin: number;
}

// ─── Stub UnitOfWork factory ───────────────────────────────────────
function createStubUow(initialProducts: StockRow[]) {
  let products = [...initialProducts];
  const insertedMovements: unknown[] = [];

  const txContext = {
    findProductForUpdate: vi.fn(async (productId: string) => {
      return products.find((p) => p.id === productId) ?? null;
    }),
    updateProductStock: vi.fn(async (productId: string, newStock: number) => {
      products = products.map((p) => (p.id === productId ? { ...p, stock: newStock } : p));
    }),
    insertStockMovement: vi.fn(async (data: unknown) => {
      insertedMovements.push(data);
    }),
    openAlertIfAbsent: vi.fn(async () => {
      // no-op in tests
    }),
    closeAlertIfAboveMin: vi.fn(async () => null),
  };

  return {
    _txContext: txContext,
    _getInsertedMovements: () => insertedMovements,
    _getProducts: () => products,
    execute: vi.fn(async (work: (ctx: typeof txContext) => Promise<unknown>) => {
      return work(txContext);
    }),
  };
}

// ─── Stub AlertCloserPort ────────────────────────────────────────
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
  let stubUow: ReturnType<typeof createStubUow>;
  let stubAlertCloser: AlertCloserPort;

  beforeEach(() => {
    const initial = [{ id: '11111111-1111-4111-8111-111111111111', stock: 10, stockMin: 5 }];
    stubUow = createStubUow(initial);
    stubAlertCloser = createStubAlertCloser();
  });

  describe('ENTRADA happy path', () => {
    it('inserts movement + updates stock; returns stockAfter', async () => {
      const service = new StockMutationService(stubUow as never, stubAlertCloser);

      const result = await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición proveedor',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(result.stockAfter).toBe(15);
      expect(stubUow._getInsertedMovements()).toHaveLength(1);
    });

    it('calls findProductForUpdate with correct productId', async () => {
      const service = new StockMutationService(stubUow as never, stubAlertCloser);

      await service.record({
        productId: '11111111-1111-4111-8111-111111111111',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Reposición',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });

      expect(stubUow._txContext.findProductForUpdate).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
      );
    });
  });

  describe('SALIDA below zero — STOCK_WOULD_GO_NEGATIVE', () => {
    it('throws StockWouldGoNegativeError with correct details', async () => {
      const service = new StockMutationService(stubUow as never, stubAlertCloser);

      await expect(
        service.record({
          productId: '11111111-1111-4111-8111-111111111111',
          type: 'SALIDA',
          quantity: 15,
          reason: 'Venta grande',
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).rejects.toThrow(StockWouldGoNegativeError);

      expect(stubUow._getInsertedMovements()).toHaveLength(0);
    });

    it('error has correct details: currentStock, requested, shortBy', async () => {
      const service = new StockMutationService(stubUow as never, stubAlertCloser);

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

  describe('Unknown product', () => {
    it('throws ProductNotFoundError when product row not found', async () => {
      const service = new StockMutationService(stubUow as never, stubAlertCloser);

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

  describe('Recovery path — crossing stock > stockMin calls AlertCloserPort', () => {
    it('calls AlertCloserPort.txCloseIfOpenAndAboveMin when newStock > stockMin', async () => {
      stubUow = createStubUow([
        { id: '11111111-1111-4111-8111-111111111111', stock: 30, stockMin: 30 },
      ]);
      stubAlertCloser = createStubAlertCloser({ result: { alertId: 'alert-closed-1' } });

      const service = new StockMutationService(stubUow as never, stubAlertCloser);

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
      stubUow = createStubUow([
        { id: '11111111-1111-4111-8111-111111111111', stock: 10, stockMin: 30 },
      ]);

      const service = new StockMutationService(stubUow as never, stubAlertCloser);

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
});

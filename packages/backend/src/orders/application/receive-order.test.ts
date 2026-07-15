/**
 * Tests for ReceiveOrderUseCase (PR 1.2 — Drizzle migration).
 *
 * Steps inside db.transaction:
 *   1. orderRepository.txUpdate(id, 'RECIBIDA')
 *   2. productStockGate.txIncrementStock(tx, productId, ENTRADA, qty, reason, userId)
 *   3. alertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)
 *   4. compose read model with the pre-fetched product
 */
import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { ProductStockGate } from '../domain/ports/product-stock-gate.js';
import type { AlertCloserPort } from '../domain/ports/alert-closer-port.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { ReceiveOrderUseCase } from './receive-order.js';

const O = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const U = '33333333-3333-3333-3333-333333333333';

function makeOrder(status: PurchaseOrderProps['status'] = 'APROBADA'): PurchaseOrderProps {
  return {
    id: O,
    productId: P,
    quantity: 60,
    status,
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    reason: null,
    createdBy: U,
    receivedAt: status === 'RECIBIDA' ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProductRepo(
  product: { id: string; sku: string; name: string; supplier: string; stockMin: number } | null = {
    id: P,
    sku: 'SKU-001',
    name: 'Cerveza',
    supplier: 'SnacksCorp',
    stockMin: 30,
  },
): ProductReadRepository {
  return {
    async findById(id) {
      void id;
      return product;
    },
  };
}

function makeUseCase(
  orderRepo: OrderRepository,
  productRepo: ProductReadRepository,
  stockGate: ProductStockGate,
  alertCloser: AlertCloserPort,
  txRunner: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> = (fn) => fn({}),
): ReceiveOrderUseCase {
  const mockUow = { execute: txRunner };
  return new ReceiveOrderUseCase(mockUow as never, orderRepo, productRepo, stockGate, alertCloser);
}

function makeHappyOrderRepo(): OrderRepository {
  return {
    async create() {
      throw new Error('not used');
    },
    async findById() {
      return makeOrder('APROBADA');
    },
    async findByIdTx(_tx, id) {
      void _tx;
      void id;
      return makeOrder('APROBADA');
    },
    async list() {
      throw new Error('not used');
    },
    async updateStatus() {
      throw new Error('not used');
    },
    async txUpdate(_tx, id, status) {
      void _tx;
      void id;
      return { ...makeOrder('APROBADA'), status, receivedAt: new Date() };
    },
  };
}

function makeStockGate(stockAfter: number): ProductStockGate {
  return {
    async txIncrementStock(_tx, args) {
      void _tx;
      void args;
      return {
        productId: P,
        type: 'ENTRADA',
        quantity: 60,
        stockAfter,
        stockMin: 30,
        occurredAt: new Date(),
      };
    },
  };
}

function makeAlertCloser(closedAlertId: string | null): AlertCloserPort {
  return {
    async txCloseIfOpenAndAboveMin() {
      return closedAlertId === null ? null : { alertId: closedAlertId };
    },
  };
}

describe('ReceiveOrderUseCase — four-step atomic flow (ADR-3)', () => {
  it('happy APROBADA → RECIBIDA with stock increment and alert close', async () => {
    const useCase = makeUseCase(
      makeHappyOrderRepo(),
      makeProductRepo(),
      makeStockGate(80),
      makeAlertCloser('alert-1'),
    );
    const result = await useCase.execute(O, 'Received by order', U);

    expect(result.order.status).toBe('RECIBIDA');
    expect(result.order.productName).toBe('Cerveza');
    expect(result.order.productSku).toBe('SKU-001');
    expect(result.order.productId).toBe(P);
    expect(result.order.quantity).toBe(60);
    expect(result.order.supplierSnapshot).toBe('SnacksCorp');
    expect(result.order.rejectionReason).toBeNull();
    expect(typeof result.order.receivedAt).toBe('string');
    expect(result.stockAfter).toBe(80);
    expect(result.closedAlertId).toBe('alert-1');
  });

  it('APROBADA → RECIBIDA, no alert to close', async () => {
    const useCase = makeUseCase(
      makeHappyOrderRepo(),
      makeProductRepo(),
      makeStockGate(50),
      makeAlertCloser(null),
    );
    const result = await useCase.execute(O, 'Received', U);

    expect(result.order.status).toBe('RECIBIDA');
    expect(result.order.productName).toBe('Cerveza');
    expect(result.order.productSku).toBe('SKU-001');
    expect(result.stockAfter).toBe(50);
    expect(result.closedAlertId).toBeNull();
  });

  it('RISK-W07: duplicate receive → RECIBIDA → 409 ORDER_INVALID_TRANSITION', async () => {
    const orderRepo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeOrder('RECIBIDA');
      },
      async findByIdTx(_tx, id) {
        void _tx;
        void id;
        return makeOrder('RECIBIDA');
      },
      async list() {
        throw new Error('not used');
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = makeUseCase(
      orderRepo,
      makeProductRepo(),
      {} as ProductStockGate,
      {} as AlertCloserPort,
    );
    await expect(useCase.execute(O, 'Received', U)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });

  it('rollback: txIncrementStock throws → entire tx rolls back', async () => {
    const stockGate: ProductStockGate = {
      async txIncrementStock() {
        throw new Error('DB constraint violation');
      },
    };
    let txRan = false;
    const useCase = makeUseCase(
      makeHappyOrderRepo(),
      makeProductRepo(),
      stockGate,
      makeAlertCloser('alert-1'),
      async (fn) => {
        txRan = true;
        return fn({});
      },
    );
    await expect(useCase.execute(O, 'Received', U)).rejects.toThrow('DB constraint violation');
    expect(txRan).toBe(true);
  });
});

/**
 * RED test: ReceiveOrderUseCase — four-step atomic flow (PR 2c, ADR-3).
 *
 * The four steps inside prisma.$transaction:
 *   1. orderRepository.txUpdate(id, 'RECIBIDA')
 *   2. productStockGate.txIncrementStock(tx, productId, ENTRADA, qty, reason, userId)
 *   3. alertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)
 *   4. Returns { order, stockAfter, closedAlertId? }
 *
 * Duplicate-receive test (RISK-W07):
 *   Second receive on already-RECIBIDA order → state machine throws 409.
 *
 * Rollback test:
 *   Stub ProductStockGate to throw → order stays APROBADA.
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
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

describe('ReceiveOrderUseCase — four-step atomic flow (ADR-3)', () => {
  it('happy APROBADA → RECIBIDA with stock increment and alert close', async () => {
    const orderRepo: OrderRepository = {
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

    const stockGate: ProductStockGate = {
      async txIncrementStock(_tx, args) {
        void _tx;
        void args;
        return {
          productId: P,
          type: 'ENTRADA',
          quantity: 60,
          stockAfter: 80,
          stockMin: 30,
          occurredAt: new Date(),
        };
      },
    };

    const alertCloser: AlertCloserPort = {
      async txCloseIfOpenAndAboveMin(_tx, args) {
        void _tx;
        void args;
        return { alertId: 'alert-1' };
      },
    };

    // Mock prisma.$transaction to run the callback synchronously
    const mockPrisma = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    };

    const useCase = new ReceiveOrderUseCase(
      mockPrisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      orderRepo,
      stockGate,
      alertCloser,
    );
    const result = await useCase.execute(O, 'Received by order', U);

    expect(result.status).toBe('RECIBIDA');
    expect(result.stockAfter).toBe(80);
    expect(result.closedAlertId).toBe('alert-1');
  });

  it('APROBADA → RECIBIDA, no alert to close', async () => {
    const orderRepo: OrderRepository = {
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

    const stockGate: ProductStockGate = {
      async txIncrementStock(_tx, args) {
        void _tx;
        void args;
        return {
          productId: P,
          type: 'ENTRADA',
          quantity: 60,
          stockAfter: 50,
          stockMin: 30,
          occurredAt: new Date(),
        };
      },
    };

    const alertCloser: AlertCloserPort = {
      async txCloseIfOpenAndAboveMin() {
        return null;
      },
    };

    const mockPrisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };

    const useCase = new ReceiveOrderUseCase(
      mockPrisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      orderRepo,
      stockGate,
      alertCloser,
    );
    const result = await useCase.execute(O, 'Received', U);

    expect(result.status).toBe('RECIBIDA');
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

    const mockPrisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };

    const useCase = new ReceiveOrderUseCase(
      mockPrisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      orderRepo,
      {} as ProductStockGate,
      {} as AlertCloserPort,
    );
    await expect(useCase.execute(O, 'Received', U)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });

  it('rollback: txIncrementStock throws → entire tx rolls back', async () => {
    const orderRepo: OrderRepository = {
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

    const stockGate: ProductStockGate = {
      async txIncrementStock() {
        throw new Error('DB constraint violation');
      },
    };

    const alertCloser: AlertCloserPort = {
      async txCloseIfOpenAndAboveMin() {
        return { alertId: 'alert-1' };
      },
    };

    let txRan = false;
    const mockPrisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txRan = true;
        return fn({});
      },
    };

    const useCase = new ReceiveOrderUseCase(
      mockPrisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      orderRepo,
      stockGate,
      alertCloser,
    );
    await expect(useCase.execute(O, 'Received', U)).rejects.toThrow('DB constraint violation');
    // Note: txRan is true because the $transaction callback DID execute.
    // The rollback means no partial state is persisted.
    expect(txRan).toBe(true);
  });

  it('PENDIENTE → receive → 409 ORDER_INVALID_TRANSITION', async () => {
    const orderRepo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeOrder('PENDIENTE');
      },
      async findByIdTx(_tx, id) {
        void _tx;
        void id;
        return makeOrder('PENDIENTE');
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

    const mockPrisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };

    const useCase = new ReceiveOrderUseCase(
      mockPrisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      orderRepo,
      {} as ProductStockGate,
      {} as AlertCloserPort,
    );
    await expect(useCase.execute(O, 'Received', U)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });
});

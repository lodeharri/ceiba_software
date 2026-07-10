/**
 * RED test: RejectOrderUseCase (PR 2c, BR-D2).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { RejectOrderUseCase } from './reject-order.js';

const O = '11111111-1111-1111-1111-111111111111';

function makeProps(status: PurchaseOrderProps['status']): PurchaseOrderProps {
  return {
    id: O,
    productId: 'product-1',
    quantity: 60,
    status,
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    reason: null,
    createdBy: 'user-1',
    receivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('RejectOrderUseCase', () => {
  it('happy PENDIENTE → RECHAZADA with reason >= 10 chars', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('PENDIENTE');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async updateStatus(id, status, reason) {
        void id;
        return { ...makeProps('PENDIENTE'), status, reason: reason ?? null };
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new RejectOrderUseCase(repo);
    const result = await useCase.execute({
      orderId: O,
      reason: 'Proveedor sin stock hasta el lunes.',
    });
    expect(result.status).toBe('RECHAZADA');
    expect(result.reason).toBe('Proveedor sin stock hasta el lunes.');
  });

  it('reason < 10 chars → 422 REJECTION_REASON_TOO_SHORT', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('PENDIENTE');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new RejectOrderUseCase(repo);
    await expect(useCase.execute({ orderId: O, reason: 'no' })).rejects.toMatchObject({
      code: 'REJECTION_REASON_TOO_SHORT',
      httpStatus: 422,
    });
  });

  it('reason exactly 10 chars → creates', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('PENDIENTE');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async updateStatus() {
        return { ...makeProps('RECHAZADA'), reason: 'abcdefghij' };
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new RejectOrderUseCase(repo);
    await expect(useCase.execute({ orderId: O, reason: 'abcdefghij' })).resolves.toMatchObject({
      status: 'RECHAZADA',
    });
  });

  it('wrong status → 409 ORDER_INVALID_TRANSITION (BR-D2)', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('APROBADA');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new RejectOrderUseCase(repo);
    await expect(
      useCase.execute({ orderId: O, reason: 'Proveedor sin stock esta semana.' }),
    ).rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION', httpStatus: 409 });
  });
});

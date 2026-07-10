/**
 * RED test: ApproveOrderUseCase (PR 2c, BR-D1).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { ApproveOrderUseCase } from './approve-order.js';

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

describe('ApproveOrderUseCase', () => {
  it('happy PENDIENTE → APROBADA', async () => {
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
      async updateStatus(id, status) {
        void id;
        const base = makeProps('PENDIENTE');
        return { ...base, status: status as 'APROBADA' };
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new ApproveOrderUseCase(repo);
    const result = await useCase.execute(O);
    expect(result.status).toBe('APROBADA');
  });

  it('unknown order → 404 NOT_FOUND', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return null;
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
    const useCase = new ApproveOrderUseCase(repo);
    await expect(useCase.execute(O)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('APROBADA → 409 ORDER_INVALID_TRANSITION (BR-D1)', async () => {
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
    const useCase = new ApproveOrderUseCase(repo);
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });

  it('RECHAZADA → 409 ORDER_INVALID_TRANSITION', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('RECHAZADA');
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
    const useCase = new ApproveOrderUseCase(repo);
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });
});

/**
 * RED test: GetOrderUseCase (PR 2c).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { GetOrderUseCase } from './get-order.js';

const O = '11111111-1111-1111-1111-111111111111';

function makeProps(status: PurchaseOrderProps['status']): PurchaseOrderProps {
  return {
    id: O,
    productId: 'product-1',
    quantity: 60,
    status,
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    reason: status === 'RECHAZADA' ? 'Proveedor sin stock.' : null,
    createdBy: 'user-1',
    receivedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };
}

describe('GetOrderUseCase', () => {
  it('happy: returns order in PENDIENTE', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('PENDIENTE');
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
    const useCase = new GetOrderUseCase(repo);
    const result = await useCase.execute(O);
    expect(result.order.status).toBe('PENDIENTE');
  });

  it('happy: returns order in RECHAZADA with reason', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return makeProps('RECHAZADA');
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
    const useCase = new GetOrderUseCase(repo);
    const result = await useCase.execute(O);
    expect(result.order.status).toBe('RECHAZADA');
    // The read model exposes rejectionReason (mapped from reason in the repo entity)
    expect(result.order.rejectionReason).toBe('Proveedor sin stock.');
  });

  it('unknown id → 404 NOT_FOUND', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        return null;
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
    const useCase = new GetOrderUseCase(repo);
    await expect(useCase.execute(O)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });
});

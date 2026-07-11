/**
 * RED test: ApproveOrderUseCase (PR 2c, BR-D1).
 *
 * The response is the composed flat Order read model (productName /
 * productSku from the joined product). If the product has been deleted
 * between order creation and approval, the use case throws
 * OrderProductInconsistencyError (422).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { ApproveOrderUseCase } from './approve-order.js';

const O = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';

function makeProps(status: PurchaseOrderProps['status']): PurchaseOrderProps {
  return {
    id: O,
    productId: P,
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

function makeOrderRepo(overrides: Partial<OrderRepository> = {}): OrderRepository {
  return {
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
    ...overrides,
  };
}

describe('ApproveOrderUseCase', () => {
  it('happy PENDIENTE → APROBADA, returns composed read model', async () => {
    const useCase = new ApproveOrderUseCase(makeOrderRepo(), makeProductRepo());
    const result = await useCase.execute(O);
    expect(result.status).toBe('APROBADA');
    expect(result.productId).toBe(P);
    expect(result.productName).toBe('Cerveza');
    expect(result.productSku).toBe('SKU-001');
    expect(result.quantity).toBe(60);
    expect(result.supplierSnapshot).toBe('SnacksCorp');
    expect(result.rejectionReason).toBeNull();
    expect(result.receivedAt).toBeNull();
  });

  it('unknown order → 404 NOT_FOUND', async () => {
    const useCase = new ApproveOrderUseCase(
      makeOrderRepo({
        async findById() {
          return null;
        },
      }),
      makeProductRepo(),
    );
    await expect(useCase.execute(O)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('APROBADA → 409 ORDER_INVALID_TRANSITION (BR-D1)', async () => {
    const useCase = new ApproveOrderUseCase(
      makeOrderRepo({
        async findById() {
          return makeProps('APROBADA');
        },
      }),
      makeProductRepo(),
    );
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });

  it('RECHAZADA → 409 ORDER_INVALID_TRANSITION', async () => {
    const useCase = new ApproveOrderUseCase(
      makeOrderRepo({
        async findById() {
          return makeProps('RECHAZADA');
        },
      }),
      makeProductRepo(),
    );
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'ORDER_INVALID_TRANSITION',
      httpStatus: 409,
    });
  });

  it('product deleted between create and approve → 422 ORDER_PRODUCT_INCONSISTENCY', async () => {
    const useCase = new ApproveOrderUseCase(makeOrderRepo(), makeProductRepo(null));
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      httpStatus: 422,
    });
  });
});

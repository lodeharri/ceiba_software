/**
 * RED test: RejectOrderUseCase (PR 2c, BR-D2).
 *
 * The response is the composed flat Order read model (productName /
 * productSku from the joined product). If the product has been deleted
 * between order creation and rejection, the use case throws
 * OrderProductInconsistencyError (422).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { RejectOrderUseCase } from './reject-order.js';

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
    async updateStatus(id, status, reason) {
      void id;
      return { ...makeProps('PENDIENTE'), status, reason: reason ?? null };
    },
    async txUpdate() {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('RejectOrderUseCase', () => {
  it('happy PENDIENTE → RECHAZADA with reason >= 10 chars', async () => {
    const useCase = new RejectOrderUseCase(makeOrderRepo(), makeProductRepo());
    const result = await useCase.execute({
      orderId: O,
      reason: 'Proveedor sin stock hasta el lunes.',
    });
    expect(result.status).toBe('RECHAZADA');
    expect(result.rejectionReason).toBe('Proveedor sin stock hasta el lunes.');
    // Composed read model — must match the canonical Order shape
    expect(result.productId).toBe(P);
    expect(result.productName).toBe('Cerveza');
    expect(result.productSku).toBe('SKU-001');
  });

  it('reason < 10 chars → 422 REJECTION_REASON_TOO_SHORT', async () => {
    const useCase = new RejectOrderUseCase(makeOrderRepo(), makeProductRepo());
    await expect(useCase.execute({ orderId: O, reason: 'no' })).rejects.toMatchObject({
      code: 'REJECTION_REASON_TOO_SHORT',
      httpStatus: 422,
    });
  });

  it('reason exactly 10 chars → creates', async () => {
    const useCase = new RejectOrderUseCase(
      makeOrderRepo({
        async updateStatus() {
          return { ...makeProps('RECHAZADA'), reason: 'abcdefghij' };
        },
      }),
      makeProductRepo(),
    );
    await expect(useCase.execute({ orderId: O, reason: 'abcdefghij' })).resolves.toMatchObject({
      status: 'RECHAZADA',
      productName: 'Cerveza',
    });
  });

  it('wrong status → 409 ORDER_INVALID_TRANSITION (BR-D2)', async () => {
    const useCase = new RejectOrderUseCase(
      makeOrderRepo({
        async findById() {
          return makeProps('APROBADA');
        },
      }),
      makeProductRepo(),
    );
    await expect(
      useCase.execute({ orderId: O, reason: 'Proveedor sin stock esta semana.' }),
    ).rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION', httpStatus: 409 });
  });
});

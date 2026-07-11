/**
 * RED test: GetOrderUseCase (PR 2c).
 *
 * Returns the composed flat `Order` read model (productName / productSku
 * from the joined product). If the product has been deleted, throws
 * OrderProductInconsistencyError (422).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { GetOrderUseCase } from './get-order.js';

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
    reason: status === 'RECHAZADA' ? 'Proveedor sin stock.' : null,
    createdBy: 'user-1',
    receivedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };
}

const PRODUCT = { id: P, sku: 'SKU-001', name: 'Cerveza', supplier: 'SnacksCorp', stockMin: 30 };

function makeProductRepo(product: typeof PRODUCT | null = PRODUCT): ProductReadRepository {
  return {
    async findById(id) {
      void id;
      return product;
    },
  };
}

function makeOrderRepo(order: PurchaseOrderProps | null): OrderRepository {
  return {
    async create() {
      throw new Error('not used');
    },
    async findById() {
      return order;
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
}

describe('GetOrderUseCase', () => {
  it('happy: returns order in PENDIENTE with composed productName/productSku', async () => {
    const useCase = new GetOrderUseCase(makeOrderRepo(makeProps('PENDIENTE')), makeProductRepo());
    const result = await useCase.execute(O);
    expect(result.order.status).toBe('PENDIENTE');
    expect(result.order.productName).toBe('Cerveza');
    expect(result.order.productSku).toBe('SKU-001');
    expect(result.order.productId).toBe(P);
    expect(result.order.quantity).toBe(60);
  });

  it('happy: returns order in RECHAZADA with reason and composed product', async () => {
    const useCase = new GetOrderUseCase(makeOrderRepo(makeProps('RECHAZADA')), makeProductRepo());
    const result = await useCase.execute(O);
    expect(result.order.status).toBe('RECHAZADA');
    expect(result.order.rejectionReason).toBe('Proveedor sin stock.');
    expect(result.order.productName).toBe('Cerveza');
  });

  it('unknown id → 404 NOT_FOUND', async () => {
    const useCase = new GetOrderUseCase(makeOrderRepo(null), makeProductRepo());
    await expect(useCase.execute(O)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('product deleted → 422 ORDER_PRODUCT_INCONSISTENCY', async () => {
    const useCase = new GetOrderUseCase(
      makeOrderRepo(makeProps('PENDIENTE')),
      makeProductRepo(null),
    );
    await expect(useCase.execute(O)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      httpStatus: 422,
    });
  });
});

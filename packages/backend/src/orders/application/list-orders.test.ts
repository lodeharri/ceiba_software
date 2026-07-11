/**
 * RED test: ListOrdersUseCase (PR 2c).
 *
 * Each row is composed via `composeOrder(order, product)` so the response
 * matches the canonical `Order` read model (productName / productSku).
 * Orders whose product has been deleted are silently dropped.
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import { ListOrdersUseCase } from './list-orders.js';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';

function makeProps(
  id: string,
  productId: string,
  status: PurchaseOrderProps['status'],
): PurchaseOrderProps {
  return {
    id,
    productId,
    quantity: 60,
    status,
    supplierSnapshot: productId === P2 ? 'Distribuidora' : 'SnacksCorp',
    fromAlertId: null,
    reason: null,
    createdBy: 'u1',
    receivedAt: status === 'RECIBIDA' ? new Date('2025-01-03') : null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };
}

const ORDERS = [
  makeProps('1', P1, 'PENDIENTE'),
  makeProps('2', P1, 'APROBADA'),
  makeProps('3', P2, 'RECIBIDA'),
];

function makeProductRepo(
  byId: Record<
    string,
    { id: string; sku: string; name: string; supplier: string; stockMin: number }
  >,
): ProductReadRepository {
  return {
    async findById(id) {
      return byId[id] ?? null;
    },
  };
}

const PRODUCT_BY_ID: Record<
  string,
  { id: string; sku: string; name: string; supplier: string; stockMin: number }
> = {
  [P1]: { id: P1, sku: 'SKU-P1', name: 'Cerveza', supplier: 'SnacksCorp', stockMin: 30 },
  [P2]: { id: P2, sku: 'SKU-P2', name: 'Papas', supplier: 'Distribuidora', stockMin: 10 },
};

function makeRepo(overrides: Partial<OrderRepository> = {}): OrderRepository {
  return {
    async create() {
      throw new Error('not used');
    },
    async findById() {
      throw new Error('not used');
    },
    async list({ page, size }) {
      return { items: ORDERS as never[], page, size, total: 3, hasMore: false };
    },
    async updateStatus() {
      throw new Error('not used');
    },
    async txUpdate() {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('ListOrdersUseCase', () => {
  it('lists all orders by default with composed productName/productSku', async () => {
    const useCase = new ListOrdersUseCase(makeRepo(), makeProductRepo(PRODUCT_BY_ID));
    const result = await useCase.execute({ page: 1, size: 20 });
    expect(result.items.length).toBe(3);
    expect(result.total).toBe(3);
    expect(result.items[0]!.productName).toBe('Cerveza');
    expect(result.items[0]!.productSku).toBe('SKU-P1');
    expect(result.items[2]!.productName).toBe('Papas');
    expect(result.items[2]!.productSku).toBe('SKU-P2');
  });

  it('filters by productId', async () => {
    const useCase = new ListOrdersUseCase(
      makeRepo({
        async list({ productId }) {
          return {
            items: ORDERS.filter((o) => o.productId === productId) as never[],
            page: 1,
            size: 20,
            total: 1,
            hasMore: false,
          };
        },
      }),
      makeProductRepo(PRODUCT_BY_ID),
    );
    const result = await useCase.execute({ productId: P1, page: 1, size: 20 });
    expect(result.items.length).toBe(2);
    expect(result.items[0]!.productSku).toBe('SKU-P1');
  });

  it('filters by status', async () => {
    const useCase = new ListOrdersUseCase(
      makeRepo({
        async list({ status }) {
          return {
            items: ORDERS.filter((o) => o.status === status) as never[],
            page: 1,
            size: 20,
            total: 1,
            hasMore: false,
          };
        },
      }),
      makeProductRepo(PRODUCT_BY_ID),
    );
    const result = await useCase.execute({ status: 'RECIBIDA', page: 1, size: 20 });
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.status).toBe('RECIBIDA');
    expect(result.items[0]!.productSku).toBe('SKU-P2');
  });

  it('pagination: page 2 of 3 items with size=2', async () => {
    const useCase = new ListOrdersUseCase(makeRepo(), makeProductRepo(PRODUCT_BY_ID));
    const result = await useCase.execute({ page: 2, size: 2 });
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('drops orders whose product has been deleted (cross-BC race)', async () => {
    // Product for P1 has been deleted; product for P2 still exists.
    const partialProductMap: Record<
      string,
      { id: string; sku: string; name: string; supplier: string; stockMin: number }
    > = {
      [P2]: { id: P2, sku: 'SKU-P2', name: 'Papas', supplier: 'Distribuidora', stockMin: 10 },
    };
    const useCase = new ListOrdersUseCase(makeRepo(), makeProductRepo(partialProductMap));
    const result = await useCase.execute({ page: 1, size: 20 });
    expect(result.total).toBe(3); // total is repo-side, includes all rows
    expect(result.items.length).toBe(1); // but only the one with a live product is returned
    expect(result.items[0]!.productSku).toBe('SKU-P2');
  });
});

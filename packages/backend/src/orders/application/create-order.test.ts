/**
 * RED test: CreateOrderUseCase (PR 2c, orders/spec.md).
 *
 * Stubbed ports: OrderRepository, ProductReadRepository, AlertReadRepository.
 *
 * The composed read model (productName / productSku) is asserted so the
 * frontend `unshift` into the orders list never produces undefined cells.
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { AlertReadRepository } from '../domain/ports/alert-read-repository.js';
import { CreateOrderUseCase } from './create-order.js';

const P = '22222222-2222-2222-2222-222222222222';
const U = '33333333-3333-3333-3333-333333333333';
const A = '44444444-4444-4444-4444-444444444444';

function makeProduct(overrides: Partial<{ supplier: string; stockMin: number }> = {}) {
  return {
    id: P,
    sku: 'SKU-001',
    name: 'Cerveza',
    supplier: 'Distribuidora Andina',
    stockMin: 30,
    ...overrides,
  };
}

function makeAlert(productId: string = P, status: 'ACTIVA' | 'RESUELTA' = 'ACTIVA') {
  return { id: A, productId, status };
}

function makeRepos(
  opts: {
    product?: { id: string; sku: string; name: string; supplier: string; stockMin: number } | null;
    alert?: { id: string; productId: string; status: 'ACTIVA' | 'RESUELTA' } | null;
  } = {},
): {
  orderRepo: OrderRepository;
  productRepo: ProductReadRepository;
  alertRepo: AlertReadRepository;
} {
  const orderRepo: OrderRepository = {
    async create(props) {
      return props as ReturnType<OrderRepository['create']> extends Promise<infer T> ? T : never;
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
  const productRepo: ProductReadRepository = {
    async findById(id) {
      void id;
      return opts.product ?? null;
    },
  };
  const alertRepo: AlertReadRepository = {
    async findById(id) {
      void id;
      return opts.alert ?? null;
    },
  };
  return { orderRepo, productRepo, alertRepo };
}

describe('CreateOrderUseCase', () => {
  it('happy: creates order in PENDIENTE with supplier snapshot (Q-P3)', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({ product: makeProduct() });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    const result = await useCase.execute({ productId: P, quantity: 60, createdBy: U });
    expect(result.status).toBe('PENDIENTE');
    expect(result.supplierSnapshot).toBe('Distribuidora Andina');
    // Composed read model — must match the canonical Order shape
    expect(result.productId).toBe(P);
    expect(result.productName).toBe('Cerveza');
    expect(result.productSku).toBe('SKU-001');
    expect(result.quantity).toBe(60);
    expect(result.rejectionReason).toBeNull();
    expect(result.receivedAt).toBeNull();
    expect(result.createdBy).toBe(U);
    expect(typeof result.createdAt).toBe('string');
    expect(typeof result.updatedAt).toBe('string');
  });

  it('happy with fromAlertId: creates order linked to ACTIVA alert', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({
      product: makeProduct(),
      alert: makeAlert(),
    });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    const result = await useCase.execute({
      productId: P,
      quantity: 60,
      fromAlertId: A,
      createdBy: U,
    });
    expect(result.fromAlertId).toBe(A);
    expect(result.productName).toBe('Cerveza');
    expect(result.productSku).toBe('SKU-001');
  });

  it('unknown product → 404 NOT_FOUND', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({ product: null });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 60, createdBy: U }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('qty < 2*stockMin → 422 ORDER_QTY_BELOW_POLICY', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({ product: makeProduct() });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 50, createdBy: U }),
    ).rejects.toMatchObject({ code: 'ORDER_QTY_BELOW_POLICY', httpStatus: 422 });
  });

  it('qty exactly at 2*stockMin → creates', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({ product: makeProduct() });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 60, createdBy: U }),
    ).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it('fromAlertId RESUELTA → 422 ALERT_NOT_ACTIVE', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({
      product: makeProduct(),
      alert: makeAlert(P, 'RESUELTA'),
    });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 60, fromAlertId: A, createdBy: U }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_ACTIVE', httpStatus: 422 });
  });

  it('fromAlertId for different product → 422 ALERT_NOT_ACTIVE', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({
      product: makeProduct(),
      alert: makeAlert('other-product'),
    });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 60, fromAlertId: A, createdBy: U }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_ACTIVE', httpStatus: 422 });
  });

  it('fromAlertId missing → 422 ALERT_NOT_ACTIVE', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({
      product: makeProduct(),
      alert: null,
    });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    await expect(
      useCase.execute({ productId: P, quantity: 60, fromAlertId: A, createdBy: U }),
    ).rejects.toMatchObject({ code: 'ALERT_NOT_ACTIVE', httpStatus: 422 });
  });

  it('Q-P3: supplier snapshot is write-once (never refreshed)', async () => {
    const { orderRepo, productRepo, alertRepo } = makeRepos({
      product: makeProduct({ supplier: 'SnacksCorp' }),
    });
    const useCase = new CreateOrderUseCase(orderRepo, productRepo, alertRepo);
    const result = await useCase.execute({ productId: P, quantity: 60, createdBy: U });
    expect(result.supplierSnapshot).toBe('SnacksCorp');
  });
});

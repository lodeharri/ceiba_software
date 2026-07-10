/**
 * RED test: ListOrdersUseCase (PR 2c).
 */

import { describe, expect, it } from 'vitest';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import { ListOrdersUseCase } from './list-orders.js';

const ORDERS = [
  {
    id: '1',
    productId: 'p1',
    quantity: 60,
    status: 'PENDIENTE',
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    reason: null,
    createdBy: 'u1',
    receivedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  {
    id: '2',
    productId: 'p1',
    quantity: 40,
    status: 'APROBADA',
    supplierSnapshot: 'SnacksCorp',
    fromAlertId: null,
    reason: null,
    createdBy: 'u1',
    receivedAt: null,
    createdAt: new Date('2025-01-02'),
    updatedAt: new Date('2025-01-02'),
  },
  {
    id: '3',
    productId: 'p2',
    quantity: 80,
    status: 'RECIBIDA',
    supplierSnapshot: 'Distribuidora',
    fromAlertId: null,
    reason: null,
    createdBy: 'u1',
    receivedAt: new Date('2025-01-03'),
    createdAt: new Date('2025-01-03'),
    updatedAt: new Date('2025-01-03'),
  },
];

describe('ListOrdersUseCase', () => {
  it('lists all orders by default', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        throw new Error('not used');
      },
      async list({ page, size }) {
        void page;
        void size;
        return { items: ORDERS as never[], page: 1, size: 20, total: 3, hasMore: false };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new ListOrdersUseCase(repo);
    const result = await useCase.execute({ page: 1, size: 20 });
    expect(result.items.length).toBe(3);
    expect(result.total).toBe(3);
  });

  it('filters by productId', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        throw new Error('not used');
      },
      async list({ productId }) {
        return {
          items: ORDERS.filter((o) => o.productId === productId) as never[],
          page: 1,
          size: 20,
          total: 1,
          hasMore: false,
        };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new ListOrdersUseCase(repo);
    const result = await useCase.execute({ productId: 'p1', page: 1, size: 20 });
    expect(result.items.length).toBe(2);
  });

  it('filters by status', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        throw new Error('not used');
      },
      async list({ status }) {
        return {
          items: ORDERS.filter((o) => o.status === status) as never[],
          page: 1,
          size: 20,
          total: 1,
          hasMore: false,
        };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new ListOrdersUseCase(repo);
    const result = await useCase.execute({ status: 'RECIBIDA', page: 1, size: 20 });
    expect(result.items.length).toBe(1);
  });

  it('pagination: page 2 of 3 items with size=2', async () => {
    const repo: OrderRepository = {
      async create() {
        throw new Error('not used');
      },
      async findById() {
        throw new Error('not used');
      },
      async list({ page, size }) {
        void page;
        void size;
        return { items: ORDERS.slice(0, 2) as never[], page: 2, size: 2, total: 3, hasMore: false };
      },
      async updateStatus() {
        throw new Error('not used');
      },
      async txUpdate() {
        throw new Error('not used');
      },
    };
    const useCase = new ListOrdersUseCase(repo);
    const result = await useCase.execute({ page: 2, size: 2 });
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(false);
  });
});

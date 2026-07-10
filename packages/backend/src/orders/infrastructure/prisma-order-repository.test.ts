/**
 * RED test: PrismaOrderRepository (PR 2c).
 *
 * Tests the adapter's Prisma surface — mocks the minimal Prisma interface.
 * Verifies:
 *   - create: maps to purchase_order table columns
 *   - findById: returns null for missing
 *   - list: orders by created_at DESC
 *   - txUpdate: ONLY public write path (ADR-3 mitigation — no separate update method)
 */

import { describe, expect, it } from 'vitest';
import { PrismaOrderRepository, type OrderPrisma } from './prisma-order-repository.js';

const O = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const U = '33333333-3333-3333-3333-333333333333';

// Minimal row type for the mock
interface OrderRow {
  id: string;
  product_id: string;
  quantity: number;
  status: string;
  supplier_snapshot: string;
  from_alert_id: string | null;
  reason: string | null;
  created_by: string;
  received_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function makeRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: O,
    product_id: P,
    quantity: 60,
    status: 'PENDIENTE',
    supplier_snapshot: 'SnacksCorp',
    from_alert_id: null,
    reason: null,
    created_by: U,
    received_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('PrismaOrderRepository', () => {
  it('create: maps to purchase_order columns', async () => {
    let capturedData: Record<string, unknown> = {};

    const mockPrisma: OrderPrisma = {
      purchaseOrder: {
        async create({ data }: { data: Record<string, unknown> }) {
          capturedData = data;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return makeRow() as any;
        },
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async findMany() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return [] as any;
        },
        async count() {
          return 0;
        },
        async update() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return makeRow() as any;
        },
      },
    };
    const repo = new PrismaOrderRepository(mockPrisma);
    await repo.create({
      id: O,
      productId: P,
      quantity: 60,
      status: 'PENDIENTE',
      supplierSnapshot: 'SnacksCorp',
      fromAlertId: null,
      reason: null,
      createdBy: U,
      receivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(capturedData['product_id']).toBe(P);
    expect(capturedData['supplier_snapshot']).toBe('SnacksCorp');
    expect(capturedData['status']).toBe('PENDIENTE');
  });

  it('findById: returns null for missing', async () => {
    const mockPrisma: OrderPrisma = {
      purchaseOrder: {
        async create() {
          throw new Error('not used');
        },
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async findMany() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return [] as any;
        },
        async count() {
          return 0;
        },
        async update() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return makeRow() as any;
        },
      },
    };
    const repo = new PrismaOrderRepository(mockPrisma);
    const result = await repo.findById('missing-id');
    expect(result).toBeNull();
  });

  it('list: orders by created_at DESC', async () => {
    let capturedOrderBy = '';

    const mockPrisma: OrderPrisma = {
      purchaseOrder: {
        async create() {
          throw new Error('not used');
        },
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async findMany({ orderBy }: { orderBy: Record<string, string> }) {
          capturedOrderBy = JSON.stringify(orderBy);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return [] as any;
        },
        async count() {
          return 0;
        },
        async update() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return makeRow() as any;
        },
      },
    };
    const repo = new PrismaOrderRepository(mockPrisma);
    await repo.list({ page: 1, size: 20 });
    expect(capturedOrderBy).toBe(JSON.stringify({ created_at: 'desc' }));
  });

  it('updateStatus: transitions to RECHAZADA with reason', async () => {
    let capturedStatus = '';

    const mockPrisma: OrderPrisma = {
      purchaseOrder: {
        async create() {
          throw new Error('not used');
        },
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async findMany() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return [] as any;
        },
        async count() {
          return 0;
        },
        async update({ data }: { data: Record<string, unknown> }) {
          capturedStatus = data['status'] as string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ...makeRow(), status: data['status'] } as any;
        },
      },
    };
    const repo = new PrismaOrderRepository(mockPrisma);
    await repo.updateStatus(O, 'RECHAZADA', 'Proveedor sin stock.');
    expect(capturedStatus).toBe('RECHAZADA');
  });

  it('txUpdate: called with tx and id + RECIBIDA', async () => {
    let capturedId = '';

    const mockTx = {
      purchaseOrder: {
        async update({
          where,
          data: _data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) {
          void _data;
          capturedId = where.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ...makeRow(), status: 'RECIBIDA', received_at: new Date() } as any;
        },
      },
    };

    const mockPrisma: OrderPrisma = {
      purchaseOrder: {
        async create() {
          throw new Error('not used');
        },
        async findUnique() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return null as any;
        },
        async findMany() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return [] as any;
        },
        async count() {
          return 0;
        },
        async update() {
          throw new Error('not used');
        },
      },
    };
    const repo = new PrismaOrderRepository(mockPrisma);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await repo.txUpdate(mockTx as any, O, 'RECIBIDA');
    expect(capturedId).toBe(O);
    expect(result.status).toBe('RECIBIDA');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { DrizzleOrderRepository } from './drizzle-order-repository.js';

const O = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const U = '33333333-3333-3333-3333-333333333333';

function createRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function createDbStub() {
  const rows: Record<string, unknown>[] = [];
  const whereChain = {
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({
        offset: vi.fn(() => Promise.resolve(rows.slice())),
      })),
    })),
    limit: vi.fn(() => Promise.resolve(rows.slice())),
  };

  return {
    _setRows(r: Record<string, unknown>[]) {
      rows.length = 0;
      rows.push(...r);
    },
    _getRows: () => rows,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([createRow()])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([createRow()])),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => whereChain),
      })),
    })),
  };
}

describe('DrizzleOrderRepository', () => {
  it('findById returns null for missing', async () => {
    const db = createDbStub();
    db._setRows([]);
    const repo = new DrizzleOrderRepository(db as never);
    const result = await repo.findById('missing-id');
    expect(result).toBeNull();
  });

  it('findById returns order when found', async () => {
    const db = createDbStub();
    db._setRows([createRow()]);
    const repo = new DrizzleOrderRepository(db as never);
    const result = await repo.findById(O);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(O);
  });

  it('create inserts an order row', async () => {
    const db = createDbStub();
    const repo = new DrizzleOrderRepository(db as never);
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
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('list returns items with pagination', async () => {
    const db = createDbStub();
    db._setRows([createRow()]);
    const repo = new DrizzleOrderRepository(db as never);
    const result = await repo.list({ page: 1, size: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(1);
  });
});

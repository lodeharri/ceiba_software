import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaAlertRepository } from './prisma-alert-repository.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- test stubs need flexible shapes */
function createPrismaStub() {
  let findUniqueResult: Record<string, unknown> | null = null;
  let findManyResult: Record<string, unknown>[] = [];
  let countResult = 0;

  const findUniqueMock = vi.fn(async () => findUniqueResult);
  const findManyMock = vi.fn(async () => findManyResult);
  const countMock = vi.fn(async () => countResult);

  return {
    _setFindUnique(row: Record<string, unknown> | null) {
      findUniqueResult = row;
    },
    _setFindMany(rows: Record<string, unknown>[]) {
      findManyResult = rows;
    },
    _setCount(n: number) {
      countResult = n;
    },
    _getFindUniqueMock: () => findUniqueMock,
    _getFindManyMock: () => findManyMock,
    _getCountMock: () => countMock,
    alert: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      count: countMock,
    },
  };
}

const ALERT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    productId: PRODUCT_ID,
    status: 'ACTIVA',
    type: 'STOCK_BAJO',
    resolvedAt: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('PrismaAlertRepository (alerts BC — infrastructure)', () => {
  let stub: ReturnType<typeof createPrismaStub>;
  let repo: PrismaAlertRepository;

  beforeEach(() => {
    stub = createPrismaStub();
    repo = new PrismaAlertRepository(stub as any);
  });

  it('findById returns AlertProps when found', async () => {
    stub._setFindUnique(alertRow());

    const result = await repo.findById(ALERT_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(ALERT_ID);
    expect(result!.productId).toBe(PRODUCT_ID);
    expect(result!.status).toBe('ACTIVA');
    expect(result!.type).toBe('STOCK_BAJO');
    expect(result!.resolvedAt).toBeUndefined();
    expect(result!.createdAt).toBeInstanceOf(Date);

    expect(stub._getFindUniqueMock()).toHaveBeenCalledWith({
      where: { id: ALERT_ID },
    });
  });

  it('findById returns null when not found', async () => {
    stub._setFindUnique(null);

    const result = await repo.findById('00000000-0000-4000-8000-000000000000');

    expect(result).toBeNull();
  });

  it('list returns items with total', async () => {
    const rows = [alertRow({ id: 'id-1' }), alertRow({ id: 'id-2', status: 'RESUELTA' })];
    stub._setFindMany(rows);
    stub._setCount(2);

    const result = await repo.list({ status: undefined, page: 0, size: 20 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.id).toBe('id-1');
    expect(result.total).toBe(2);

    expect(stub._getFindManyMock()).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('list filters by status when provided', async () => {
    stub._setFindMany([alertRow()]);
    stub._setCount(1);

    await repo.list({ status: 'ACTIVA', page: 0, size: 20 });

    expect(stub._getFindManyMock()).toHaveBeenCalledWith({
      where: { status: 'ACTIVA' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
  });

  it('list paginates correctly', async () => {
    stub._setFindMany([]);
    stub._setCount(50);

    const result = await repo.list({ status: undefined, page: 2, size: 10 });

    expect(stub._getFindManyMock()).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 10,
    });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(50);
  });

  it('count delegates to prisma with optional status filter', async () => {
    stub._setCount(5);

    const result = await repo.count({ status: 'ACTIVA' });

    expect(result).toBe(5);
    expect(stub._getCountMock()).toHaveBeenCalledWith({ where: { status: 'ACTIVA' } });
  });
});

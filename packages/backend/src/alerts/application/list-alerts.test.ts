import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ListAlerts } from './list-alerts.js';
import type { AlertRepository } from '../domain/ports/alert-repository.js';
import type { ProductReadPort, ProductSnapshot } from '../domain/ports/product-read-port.js';
import type { AlertProps } from '../domain/alert.js';

const ALERT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function makeAlert(overrides: Partial<AlertProps> = {}): AlertProps {
  return {
    id: ALERT_ID,
    productId: PRODUCT_ID,
    status: 'ACTIVA',
    type: 'STOCK_BAJO',
    resolvedAt: undefined,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    id: PRODUCT_ID,
    name: 'Test Product',
    sku: 'SKU123',
    stock: 5,
    stockMin: 10,
    ...overrides,
  };
}

function createStubs() {
  const listMock = vi.fn();
  const countMock = vi.fn();
  const findProductMock = vi.fn();

  const alertRepo: AlertRepository = {
    findById: vi.fn(),
    list: listMock,
    count: countMock,
  };

  const productRead: ProductReadPort = {
    findById: findProductMock,
  };

  return { alertRepo, productRead, listMock, countMock, findProductMock };
}

describe('ListAlerts (alerts BC — application)', () => {
  let stubs: ReturnType<typeof createStubs>;
  let useCase: ListAlerts;

  beforeEach(() => {
    stubs = createStubs();
    useCase = new ListAlerts(stubs.alertRepo, stubs.productRead);
  });

  it('returns paginated alerts with product snapshot', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert()],
      total: 1,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ status: 'BOTH', page: 0, size: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.alert.id).toBe(ALERT_ID);
    expect(result.items[0]!.product.name).toBe('Test Product');
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('defaults to status=BOTH, page=0, size=20', async () => {
    stubs.listMock.mockResolvedValue({ items: [], total: 0 });

    await useCase.execute();

    expect(stubs.listMock).toHaveBeenCalledWith({
      status: undefined, // BOTH means no filter
      page: 0,
      size: 20,
    });
  });

  it('filters by ACTIVA status', async () => {
    stubs.listMock.mockResolvedValue({ items: [makeAlert()], total: 1 });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    await useCase.execute({ status: 'ACTIVA' });

    expect(stubs.listMock).toHaveBeenCalledWith({
      status: 'ACTIVA',
      page: 0,
      size: 20,
    });
  });

  it('filters by RESUELTA status', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert({ status: 'RESUELTA', resolvedAt: new Date() })],
      total: 1,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    await useCase.execute({ status: 'RESUELTA' });

    expect(stubs.listMock).toHaveBeenCalledWith({
      status: 'RESUELTA',
      page: 0,
      size: 20,
    });
  });

  it('returns correct pagination metadata', async () => {
    stubs.listMock.mockResolvedValue({ items: [makeAlert()], total: 50 });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ page: 1, size: 10 });

    expect(result.page).toBe(1);
    expect(result.size).toBe(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('throws validation error for invalid status', async () => {
    await expect(
      useCase.execute({ status: 'INVALID' as any }), // eslint-disable-line @typescript-eslint/no-explicit-any
    ).rejects.toThrow(/status/i);
  });
});

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

  it('returns paginated flat alerts with composed product snapshot', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert()],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ status: 'BOTH', page: 1, size: 20 });

    expect(result.items).toHaveLength(1);
    // Flat read model: id / productName / productSku live on the item itself
    // (NOT under a nested `alert` / `product` shape — that contract was removed).
    expect(result.items[0]!.id).toBe(ALERT_ID);
    expect(result.items[0]!.productName).toBe('Test Product');
    expect(result.items[0]!.productSku).toBe('SKU123');
    expect(result.items[0]!.stockAtOpen).toBe(5);
    expect(result.items[0]!.stockMin).toBe(10);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('defaults to status=BOTH, page=1, size=20', async () => {
    stubs.listMock.mockResolvedValue({ items: [], page: 1, size: 20, total: 0, hasMore: false });

    await useCase.execute();

    expect(stubs.listMock).toHaveBeenCalledWith({
      page: 1,
      size: 20,
    });
  });

  it('filters by ACTIVA status', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert()],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    await useCase.execute({ status: 'ACTIVA' });

    expect(stubs.listMock).toHaveBeenCalledWith({
      status: 'ACTIVA',
      page: 1,
      size: 20,
    });
  });

  it('filters by RESUELTA status', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert({ status: 'RESUELTA', resolvedAt: new Date() })],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    await useCase.execute({ status: 'RESUELTA' });

    expect(stubs.listMock).toHaveBeenCalledWith({
      status: 'RESUELTA',
      page: 1,
      size: 20,
    });
  });

  it('returns correct pagination metadata', async () => {
    stubs.listMock.mockResolvedValue({
      items: [makeAlert()],
      page: 1,
      size: 10,
      total: 50,
      hasMore: true,
    });
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

  it('serializes resolvedAt as ISO string and createdAt as ISO string', async () => {
    const resolvedAt = new Date('2025-01-16T12:00:00Z');
    stubs.listMock.mockResolvedValue({
      items: [makeAlert({ status: 'RESUELTA', resolvedAt })],
      page: 1,
      size: 20,
      total: 1,
      hasMore: false,
    });
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ status: 'RESUELTA' });

    expect(result.items[0]!.status).toBe('RESUELTA');
    expect(result.items[0]!.resolvedAt).toBe('2025-01-16T12:00:00.000Z');
    expect(result.items[0]!.createdAt).toBe('2025-01-15T10:00:00.000Z');
  });

  it('silently drops alerts whose product has been deleted', async () => {
    const SECOND_PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
    stubs.listMock.mockResolvedValue({
      items: [
        makeAlert(),
        makeAlert({
          id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          productId: SECOND_PRODUCT_ID,
        }),
      ],
      page: 1,
      size: 20,
      total: 2,
      hasMore: false,
    });
    // First product exists, second is gone (deleted since the alert opened).
    stubs.findProductMock.mockImplementation(async (id: string) =>
      id === PRODUCT_ID ? makeProduct() : null,
    );

    const result = await useCase.execute();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(ALERT_ID);
  });
});

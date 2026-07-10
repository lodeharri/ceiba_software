import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GetAlert } from './get-alert.js';
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
  const findByIdMock = vi.fn();
  const findProductMock = vi.fn();

  const alertRepo: AlertRepository = {
    findById: findByIdMock,
    list: vi.fn(),
    count: vi.fn(),
  };

  const productRead: ProductReadPort = {
    findById: findProductMock,
  };

  return { alertRepo, productRead, findByIdMock, findProductMock };
}

describe('GetAlert (alerts BC — application)', () => {
  let stubs: ReturnType<typeof createStubs>;
  let useCase: GetAlert;

  beforeEach(() => {
    stubs = createStubs();
    useCase = new GetAlert(stubs.alertRepo, stubs.productRead);
  });

  it('returns alert with product snapshot for ACTIVA alert', async () => {
    stubs.findByIdMock.mockResolvedValue(makeAlert());
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ id: ALERT_ID });

    expect(result.alert.id).toBe(ALERT_ID);
    expect(result.alert.status).toBe('ACTIVA');
    expect(result.alert.resolvedAt).toBeUndefined();
    expect(result.product.name).toBe('Test Product');
  });

  it('returns alert with resolvedAt for RESUELTA alert', async () => {
    const resolvedAt = new Date('2025-01-16T12:00:00Z');
    stubs.findByIdMock.mockResolvedValue(makeAlert({ status: 'RESUELTA', resolvedAt }));
    stubs.findProductMock.mockResolvedValue(makeProduct());

    const result = await useCase.execute({ id: ALERT_ID });

    expect(result.alert.status).toBe('RESUELTA');
    expect(result.alert.resolvedAt).toEqual(resolvedAt);
  });

  it('throws AlertNotFoundError for unknown id', async () => {
    stubs.findByIdMock.mockResolvedValue(null);

    await expect(useCase.execute({ id: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(
      /not found/i,
    );
  });
});

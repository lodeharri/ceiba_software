import { describe, expect, it } from 'vitest';
import { Alert } from './alert.js';

describe('Alert.create (alerts BC — domain)', () => {
  const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

  it('creates a valid ACTIVA alert', () => {
    const alert = Alert.create({
      id: '22222222-2222-4222-8222-222222222222',
      productId: PRODUCT_ID,
      status: 'ACTIVA',
    });

    expect(alert.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(alert.productId).toBe(PRODUCT_ID);
    expect(alert.status).toBe('ACTIVA');
    expect(alert.type).toBe('STOCK_BAJO');
    expect(alert.resolvedAt).toBeUndefined();
    expect(alert.createdAt).toBeInstanceOf(Date);
  });

  it('creates a valid RESUELTA alert with resolvedAt', () => {
    const resolvedAt = new Date('2026-07-09T12:00:00Z');
    const alert = Alert.create({
      id: '33333333-3333-4333-8333-333333333333',
      productId: PRODUCT_ID,
      status: 'RESUELTA',
      resolvedAt,
    });

    expect(alert.status).toBe('RESUELTA');
    expect(alert.resolvedAt).toBe(resolvedAt);
  });

  it('rejects invalid status', () => {
    expect(() =>
      Alert.create({
        id: '44444444-4444-4444-8444-444444444444',
        productId: PRODUCT_ID,
        status: 'UNKNOWN' as never,
      }),
    ).toThrow(/status/);
  });

  it('rejects empty productId', () => {
    expect(() =>
      Alert.create({
        id: '55555555-5555-5555-8555-555555555555',
        productId: '',
        status: 'ACTIVA',
      }),
    ).toThrow(/productId/);
  });

  it('rejects invalid UUID for productId', () => {
    expect(() =>
      Alert.create({
        id: '66666666-6666-6666-8666-666666666666',
        productId: 'not-a-uuid',
        status: 'ACTIVA',
      }),
    ).toThrow(/productId/);
  });

  it('rejects invalid UUID for id', () => {
    expect(() =>
      Alert.create({
        id: 'not-a-uuid',
        productId: PRODUCT_ID,
        status: 'ACTIVA',
      }),
    ).toThrow(/id/);
  });

  it('rehydrates from props', () => {
    const resolvedAt = new Date('2026-07-09T12:00:00Z');
    const alert = Alert.rehydrate({
      id: '77777777-7777-7777-8777-777777777777',
      productId: PRODUCT_ID,
      status: 'RESUELTA',
      type: 'STOCK_BAJO',
      resolvedAt,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    });

    expect(alert.status).toBe('RESUELTA');
    expect(alert.resolvedAt).toBe(resolvedAt);
  });

  it('toReadModel returns correct shape', () => {
    const alert = Alert.create({
      id: '88888888-8888-8888-8888-888888888888',
      productId: PRODUCT_ID,
      status: 'ACTIVA',
    });

    const model = alert.toReadModel();
    expect(model).toEqual({
      id: '88888888-8888-8888-8888-888888888888',
      productId: PRODUCT_ID,
      status: 'ACTIVA',
      type: 'STOCK_BAJO',
      resolvedAt: null,
      createdAt: expect.any(String),
    });
  });
});

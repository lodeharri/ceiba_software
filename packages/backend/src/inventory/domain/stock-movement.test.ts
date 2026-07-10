import { describe, expect, it } from 'vitest';
import { StockMovement } from './stock-movement.js';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('StockMovement.create (inventory BC — domain)', () => {
  it('creates a valid ENTRADA movement', () => {
    const movement = StockMovement.create({
      id: '22222222-2222-4222-8222-222222222222',
      productId: PRODUCT_ID,
      type: 'ENTRADA',
      quantity: 5,
      reason: 'Reposición proveedor',
      userId: USER_ID,
    });

    expect(movement.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(movement.productId).toBe(PRODUCT_ID);
    expect(movement.type).toBe('ENTRADA');
    expect(movement.quantity).toBe(5);
    expect(movement.reason).toBe('Reposición proveedor');
    expect(movement.userId).toBe(USER_ID);
    expect(movement.createdAt).toBeInstanceOf(Date);
  });

  it('creates a valid SALIDA movement', () => {
    const movement = StockMovement.create({
      id: '33333333-3333-4333-8333-333333333333',
      productId: PRODUCT_ID,
      type: 'SALIDA',
      quantity: 3,
      reason: 'Venta mostrador',
      userId: USER_ID,
    });

    expect(movement.type).toBe('SALIDA');
    expect(movement.quantity).toBe(3);
  });
});

describe('StockMovement.applyTo (BR-D7, BR-D8)', () => {
  it('ENTRADA increases stock (currentStock + quantity)', () => {
    const movement = StockMovement.create({
      id: '44444444-4444-4444-8444-444444444444',
      productId: PRODUCT_ID,
      type: 'ENTRADA',
      quantity: 5,
      reason: 'Reposición',
      userId: USER_ID,
    });

    expect(movement.applyTo(10)).toBe(15);
  });

  it('SALIDA decreases stock (currentStock - quantity)', () => {
    const movement = StockMovement.create({
      id: '55555555-5555-5555-8555-555555555555',
      productId: PRODUCT_ID,
      type: 'SALIDA',
      quantity: 3,
      reason: 'Venta',
      userId: USER_ID,
    });

    expect(movement.applyTo(10)).toBe(7);
  });

  it('SALIDA exactly to zero succeeds', () => {
    const movement = StockMovement.create({
      id: '66666666-6666-6666-8666-666666666666',
      productId: PRODUCT_ID,
      type: 'SALIDA',
      quantity: 10,
      reason: 'Venta total',
      userId: USER_ID,
    });

    expect(movement.applyTo(10)).toBe(0);
  });
});

describe('StockMovement invariants', () => {
  it('rejects quantity = 0', () => {
    expect(() =>
      StockMovement.create({
        id: '77777777-7777-7777-8777-777777777777',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 0,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).toThrow(/quantity/);
  });

  it('rejects negative quantity', () => {
    expect(() =>
      StockMovement.create({
        id: '88888888-8888-8888-8888-888888888888',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: -5,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).toThrow(/quantity/);
  });

  it('rejects empty reason', () => {
    expect(() =>
      StockMovement.create({
        id: '99999999-9999-9999-8999-999999999999',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 5,
        reason: '',
        userId: USER_ID,
      }),
    ).toThrow(/reason/);
  });

  it('rejects invalid productId', () => {
    expect(() =>
      StockMovement.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        productId: 'not-a-uuid',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).toThrow(/productId/);
  });

  it('rejects invalid UUID for id', () => {
    expect(() =>
      StockMovement.create({
        id: 'not-a-uuid',
        productId: PRODUCT_ID,
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).toThrow(/id/);
  });

  it('rejects invalid MovementType', () => {
    expect(() =>
      StockMovement.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        productId: PRODUCT_ID,
        type: 'INVALID' as never,
        quantity: 5,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).toThrow(/type/);
  });
});

describe('StockMovement.sign derives from type (BR-D8)', () => {
  it('ENTRADA always produces positive delta', () => {
    const entrada = StockMovement.create({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      productId: PRODUCT_ID,
      type: 'ENTRADA',
      quantity: 100,
      reason: 'Big restock',
      userId: USER_ID,
    });
    const after = entrada.applyTo(0);
    expect(after).toBe(100);
  });

  it('SALIDA always produces negative delta', () => {
    const salida = StockMovement.create({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      productId: PRODUCT_ID,
      type: 'SALIDA',
      quantity: 50,
      reason: 'Big sale',
      userId: USER_ID,
    });
    const after = salida.applyTo(100);
    expect(after).toBe(50);
  });
});

import { describe, expect, it } from 'vitest';
import { Product } from './product.js';

const CAT = '00000000-0000-4000-8000-000000000001';
const VALID = {
  id: '11111111-1111-4111-8111-111111111111',
  sku: 'BEB-001',
  name: 'Agua Mineral 500ml',
  categoryId: CAT,
  price: 1500,
  stock: 200,
  stockMin: 50,
  supplier: 'Distribuidora Andina',
};

describe('Product.create (products BC — domain)', () => {
  it('creates a valid product', () => {
    const p = Product.create(VALID);
    expect(p.sku).toBe('BEB-001');
    expect(p.price).toBe(1500);
    expect(p.stockMin).toBe(50);
  });

  it('rejects name shorter than 3 chars', () => {
    expect(() => Product.create({ ...VALID, name: 'ab' })).toThrow(/name/);
  });

  it('rejects a too-short SKU', () => {
    expect(() => Product.create({ ...VALID, sku: 'ab' })).toThrow(/sku/);
  });

  it('rejects a non-alphanumeric SKU', () => {
    expect(() => Product.create({ ...VALID, sku: 'A!B@CDEF' })).toThrow(/sku/);
  });

  it('rejects price <= 0', () => {
    expect(() => Product.create({ ...VALID, price: 0 })).toThrow(/price/);
    expect(() => Product.create({ ...VALID, price: -1 })).toThrow(/price/);
  });

  it('rejects stock < 0', () => {
    expect(() => Product.create({ ...VALID, stock: -1 })).toThrow(/stock/);
  });

  it('rejects stockMin <= 0', () => {
    expect(() => Product.create({ ...VALID, stockMin: 0 })).toThrow(/stockMin/);
  });

  it('rejects a missing supplier', () => {
    expect(() => Product.create({ ...VALID, supplier: '' })).toThrow(/supplier/);
  });
});

describe('Product.toReadModel (products BC — domain wire format)', () => {
  // The shared contract (`packages/shared/src/schemas/products/product.ts`)
  // requires `price` as a string (Money on the wire = integer COP string)
  // and `hasActiveAlert` as a boolean (denormalized from the alerts BC).
  // The entity must emit BOTH fields; otherwise the backend response will
  // fail Zod parse on the frontend (NaN, scientific notation, missing flag).
  const PROPS = {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'BEB-001',
    name: 'Agua Mineral 500ml',
    categoryId: '00000000-0000-4000-8000-000000000001',
    price: 1500,
    stock: 200,
    stockMin: 50,
    supplier: 'Distribuidora Andina',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('serialises price as an integer string (Money wire format D4)', () => {
    const p = Product.rehydrate(PROPS);
    const read = p.toReadModel();
    expect(typeof read.price).toBe('string');
    expect(read.price).toBe('1500');
  });

  it('defaults hasActiveAlert to false when not enriched', () => {
    const p = Product.rehydrate(PROPS);
    expect(p.toReadModel().hasActiveAlert).toBe(false);
  });

  it('withAlertFlag carries the cross-BC flag into the read model', () => {
    const p = Product.rehydrate(PROPS).withAlertFlag(true);
    expect(p.toReadModel().hasActiveAlert).toBe(true);
    const pFalse = Product.rehydrate(PROPS).withAlertFlag(false);
    expect(pFalse.toReadModel().hasActiveAlert).toBe(false);
  });

  it('withAlertFlag returns a new instance (does not mutate the original)', () => {
    const original = Product.rehydrate(PROPS);
    const enriched = original.withAlertFlag(true);
    expect(original.toReadModel().hasActiveAlert).toBe(false);
    expect(enriched.toReadModel().hasActiveAlert).toBe(true);
    expect(enriched).not.toBe(original);
  });

  it('emits createdAt and updatedAt as ISO datetime strings', () => {
    const p = Product.rehydrate(PROPS);
    const read = p.toReadModel();
    expect(read.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(read.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

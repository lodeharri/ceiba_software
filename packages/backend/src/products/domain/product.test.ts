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

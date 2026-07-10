/**
 * RED test: ProductReadRepository port interface (PR 2c).
 */

import { describe, expect, it } from 'vitest';

interface MockRepo {
  findById: (id: string) => Promise<{
    id: string;
    sku: string;
    name: string;
    supplier: string;
    stockMin: number;
  } | null>;
}

describe('ProductReadRepository port interface', () => {
  it('must expose findById method', () => {
    const mock: MockRepo = { findById: async () => null };
    expect(typeof mock.findById).toBe('function');
  });

  it('findById returns null for missing product', async () => {
    const mock: MockRepo = { findById: async () => null };
    const result = await mock.findById('missing-id');
    expect(result).toBeNull();
  });

  it('findById returns ProductReadModel with supplier', async () => {
    const mock: MockRepo = {
      findById: async () => ({
        id: '1',
        sku: 'SKU-001',
        name: 'Cerveza',
        supplier: 'SnacksCorp',
        stockMin: 30,
      }),
    };
    const result = await mock.findById('1');
    expect(result).not.toBeNull();
    expect(result!.supplier).toBe('SnacksCorp');
    expect(result!.stockMin).toBe(30);
  });
});

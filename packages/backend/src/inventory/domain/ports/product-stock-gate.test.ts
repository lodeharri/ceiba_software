import { describe, expect, it } from 'vitest';
import type { StockMovementRepository } from './stock-movement-repository.js';
import type { ProductStockGate } from './product-stock-gate.js';

describe('StockMovementRepository (inventory BC — domain port)', () => {
  it('is a TypeScript interface with append and listByProduct methods (no update/delete — BR-6)', () => {
    const stub: StockMovementRepository = {
      append: async () => ({}),
      listByProduct: async () => ({ items: [], total: 0 }),
    };
    expect(typeof stub.append).toBe('function');
    expect(typeof stub.listByProduct).toBe('function');
    // BR-6: no update or delete methods
    expect('update' in stub).toBe(false);
    expect('delete' in stub).toBe(false);
  });
});

describe('ProductStockGate (inventory BC — domain port)', () => {
  it('is a TypeScript interface with txIncrementStock method', () => {
    const stub: ProductStockGate = {
      txIncrementStock: async () => ({
        productId: 'test',
        type: 'ENTRADA' as const,
        quantity: 0,
        stockAfter: 0,
        stockMin: 0,
        occurredAt: new Date(),
      }),
    };
    expect(typeof stub.txIncrementStock).toBe('function');
  });
});

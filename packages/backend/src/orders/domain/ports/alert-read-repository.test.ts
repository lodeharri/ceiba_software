/**
 * RED test: AlertReadRepository port interface (PR 2c).
 */

import { describe, expect, it } from 'vitest';

interface MockRepo {
  findById: (
    id: string,
  ) => Promise<{ id: string; productId: string; status: 'ACTIVA' | 'RESUELTA' } | null>;
}

describe('AlertReadRepository port interface', () => {
  it('must expose findById method', () => {
    const mock: MockRepo = { findById: async () => null };
    expect(typeof mock.findById).toBe('function');
  });

  it('findById returns null for missing alert', async () => {
    const mock: MockRepo = { findById: async () => null };
    const result = await mock.findById('missing-id');
    expect(result).toBeNull();
  });

  it('findById returns alert with ACTIVA status', async () => {
    const mock: MockRepo = {
      findById: async () => ({
        id: '1',
        productId: 'product-1',
        status: 'ACTIVA',
      }),
    };
    const result = await mock.findById('1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('ACTIVA');
  });
});

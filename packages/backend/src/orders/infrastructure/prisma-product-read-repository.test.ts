/**
 * RED test: PrismaProductReadRepository (PR 2c).
 */

import { describe, expect, it } from 'vitest';
import {
  PrismaProductReadRepository,
  type ProductPrisma,
} from './prisma-product-read-repository.js';

const P = '22222222-2222-2222-2222-222222222222';

describe('PrismaProductReadRepository', () => {
  it('findById returns null for missing', async () => {
    const mockPrisma: ProductPrisma = {
      product: {
        async findUnique() {
          return null;
        },
      },
    };
    const repo = new PrismaProductReadRepository(mockPrisma);
    const result = await repo.findById('missing-id');
    expect(result).toBeNull();
  });

  it('findById returns supplier and stockMin', async () => {
    const mockPrisma: ProductPrisma = {
      product: {
        async findUnique() {
          return {
            id: P,
            sku: 'SKU-001',
            name: 'Cerveza',
            supplier: 'Distribuidora Andina',
            stock_min: 30,
          };
        },
      },
    };
    const repo = new PrismaProductReadRepository(mockPrisma);
    const result = await repo.findById(P);
    expect(result).not.toBeNull();
    expect(result!.supplier).toBe('Distribuidora Andina');
    expect(result!.stockMin).toBe(30);
  });
});

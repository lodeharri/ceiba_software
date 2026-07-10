/**
 * RED test: PrismaAlertReadRepository (PR 2c).
 */

import { describe, expect, it } from 'vitest';
import { PrismaAlertReadRepository, type AlertPrisma } from './prisma-alert-read-repository.js';

const A = '44444444-4444-4444-4444-444444444444';

describe('PrismaAlertReadRepository', () => {
  it('findById returns null for missing', async () => {
    const mockPrisma: AlertPrisma = {
      alert: {
        async findUnique() {
          return null;
        },
      },
    };
    const repo = new PrismaAlertReadRepository(mockPrisma);
    const result = await repo.findById('missing-id');
    expect(result).toBeNull();
  });

  it('findById returns ACTIVA status', async () => {
    const mockPrisma: AlertPrisma = {
      alert: {
        async findUnique() {
          return { id: A, product_id: 'product-1', status: 'ACTIVA' };
        },
      },
    };
    const repo = new PrismaAlertReadRepository(mockPrisma);
    const result = await repo.findById(A);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('ACTIVA');
  });
});

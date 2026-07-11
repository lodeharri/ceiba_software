/**
 * Orders BC — PrismaAlertReadRepository (PR 2c).
 *
 * Read-only adapter implementing `AlertReadRepository`.
 * Used at order-create time to validate `fromAlertId`.
 */

import type { AlertReadRepository, AlertReadModel } from '../domain/ports/alert-read-repository.js';

interface AlertRow {
  id: string;
  productId: string;
  status: string;
}

export interface AlertPrisma {
  alert: {
    findUnique(args: { where: { id: string } }): Promise<AlertRow | null>;
  };
}

export class PrismaAlertReadRepository implements AlertReadRepository {
  constructor(private readonly prisma: AlertPrisma) {}

  async findById(id: string): Promise<AlertReadModel | null> {
    const row = await this.prisma.alert.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      productId: row.productId,
      status: row.status as 'ACTIVA' | 'RESUELTA',
    };
  }
}

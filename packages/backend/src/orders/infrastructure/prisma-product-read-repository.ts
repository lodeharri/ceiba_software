/**
 * Orders BC — PrismaProductReadRepository (PR 2c).
 *
 * Read-only adapter implementing `ProductReadRepository`.
 * Used at order-create time to validate product existence and snapshot supplier.
 */

import type {
  ProductReadRepository,
  ProductReadModel,
} from '../domain/ports/product-read-repository.js';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  supplier: string;
  stock_min: number;
}

export interface ProductPrisma {
  product: {
    findUnique(args: { where: { id: string } }): Promise<ProductRow | null>;
  };
}

export class PrismaProductReadRepository implements ProductReadRepository {
  constructor(private readonly prisma: ProductPrisma) {}

  async findById(id: string): Promise<ProductReadModel | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      supplier: row.supplier,
      stockMin: row.stock_min,
    };
  }
}

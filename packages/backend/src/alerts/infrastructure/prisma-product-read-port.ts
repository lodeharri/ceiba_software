/**
 * Alerts BC — PrismaProductReadPort (PR 2b).
 *
 * Read-only adapter that fetches product snapshots for alert read models.
 * This adapter wraps the same Prisma client the alerts Lambda uses.
 */

import type { ProductReadPort, ProductSnapshot } from '../domain/ports/product-read-port.js';

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  stock: number;
  stockMin: number;
}

/** Minimal Prisma surface the product read port needs. */
export interface ProductReadPrisma {
  product: {
    findUnique(args: { where: { id: string } }): Promise<ProductRow | null>;
  };
}

export class PrismaProductReadPort implements ProductReadPort {
  constructor(private readonly prisma: ProductReadPrisma) {}

  async findById(id: string): Promise<ProductSnapshot | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      stock: row.stock,
      stockMin: row.stockMin,
    };
  }
}

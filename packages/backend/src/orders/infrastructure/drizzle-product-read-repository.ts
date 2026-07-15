/**
 * Orders BC — DrizzleProductReadRepository (PR 1.2).
 *
 * Read-only adapter implementing `ProductReadRepository`.
 * Replaces `PrismaProductReadRepository` for the Prisma → Drizzle migration.
 */

import { eq } from 'drizzle-orm';
import type {
  ProductReadRepository,
  ProductReadModel,
} from '../domain/ports/product-read-repository.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleProductReadRepository implements ProductReadRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<ProductReadModel | null> {
    const [row] = await this.db
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        name: schema.products.name,
        supplier: schema.products.supplier,
        stockMin: schema.products.stockMin,
      })
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      supplier: row.supplier,
      stockMin: row.stockMin,
    };
  }
}

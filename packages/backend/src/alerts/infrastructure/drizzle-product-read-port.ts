/**
 * Alerts BC — DrizzleProductReadPort (PR 1.2).
 *
 * Read-only adapter that fetches product snapshots for alert read models.
 * Replaces `PrismaProductReadPort` for the Prisma → Drizzle migration.
 */

import { eq } from 'drizzle-orm';
import type { ProductReadPort, ProductSnapshot } from '../domain/ports/product-read-port.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleProductReadPort implements ProductReadPort {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<ProductSnapshot | null> {
    const [row] = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        sku: schema.products.sku,
        stock: schema.products.stock,
        stockMin: schema.products.stockMin,
      })
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
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

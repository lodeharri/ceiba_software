/**
 * Inventory BC — DrizzleStockMovementRepository (PR 1.2, design.md §5.3).
 *
 * Append-only adapter per BR-6: no update or delete methods.
 * Replaces `PrismaStockMovementRepository` for the Prisma → Drizzle migration.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { StockMovementRepository } from '../domain/ports/stock-movement-repository.js';
import type { StockMovementProps } from '../domain/stock-movement.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

interface DrizzleMovementRow {
  id: string;
  productId: string;
  type: string;
  quantity: number;
  reason: string;
  userId: string;
  stockAfter: number;
  createdAt: Date;
}

export class DrizzleStockMovementRepository implements StockMovementRepository {
  constructor(private readonly db = getDb()) {}

  async append(movement: StockMovementProps): Promise<void> {
    await this.db.insert(schema.stockMovements).values({
      id: movement.id,
      productId: movement.productId,
      type: movement.type,
      quantity: movement.quantity,
      reason: movement.reason,
      userId: movement.userId,
      stockAfter: movement.stockAfter,
      createdAt: movement.createdAt,
    });
  }

  async listByProduct(args: { productId: string; page: number; size: number }): Promise<{
    items: StockMovementProps[];
    page: number;
    size: number;
    total: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, args.page);
    const size = Math.max(1, Math.min(200, args.size));
    const where = eq(schema.stockMovements.productId, args.productId);

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.stockMovements)
        .where(where)
        .orderBy(desc(schema.stockMovements.createdAt))
        .limit(size)
        .offset((page - 1) * size),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.stockMovements)
        .where(where)
        .limit(1),
    ]);

    return {
      items: items.map(toProps),
      page,
      size,
      total: countRow?.count ?? 0,
      hasMore: page * size < (countRow?.count ?? 0),
    };
  }
}

function toProps(row: DrizzleMovementRow): StockMovementProps {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type as StockMovementProps['type'],
    quantity: row.quantity,
    reason: row.reason,
    userId: row.userId,
    stockAfter: row.stockAfter,
    createdAt: row.createdAt,
  };
}

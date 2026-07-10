/**
 * Inventory BC — PrismaStockMovementRepository (PR 2b, design.md §5.3).
 *
 * Append-only adapter per BR-6: no update or delete methods.
 * Uses a minimal Prisma surface so the adapter compiles without
 * requiring the generated Prisma client to be present.
 */

import type { StockMovementRepository } from '../domain/ports/stock-movement-repository.js';
import type { StockMovementProps } from '../domain/stock-movement.js';

interface MovementRow {
  id: string;
  productId: string;
  type: string;
  quantity: number;
  reason: string;
  userId: string;
  createdAt: Date;
}

/** Minimal Prisma surface the repository needs. */
export interface StockMovementPrisma {
  stockMovement: {
    create(args: { data: Record<string, unknown> }): Promise<MovementRow>;
    findMany(args: {
      where: { productId: string };
      orderBy: { createdAt: 'desc' | 'asc' };
      skip: number;
      take: number;
    }): Promise<MovementRow[]>;
    count(args: { where: { productId: string } }): Promise<number>;
  };
}

export class PrismaStockMovementRepository implements StockMovementRepository {
  constructor(private readonly prisma: StockMovementPrisma) {}

  async append(movement: StockMovementProps): Promise<void> {
    await this.prisma.stockMovement.create({
      data: {
        id: movement.id,
        productId: movement.productId,
        type: movement.type,
        quantity: movement.quantity,
        reason: movement.reason,
        userId: movement.userId,
        createdAt: movement.createdAt,
      },
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
    const where = { productId: args.productId };

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      items: rows.map(toProps),
      page,
      size,
      total,
      hasMore: page * size < total,
    };
  }
}

function toProps(row: MovementRow): StockMovementProps {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type as StockMovementProps['type'],
    quantity: row.quantity,
    reason: row.reason,
    userId: row.userId,
    createdAt: row.createdAt,
  };
}

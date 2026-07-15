/**
 * Inventory BC — DrizzleProductStockGate (PR 1.2, design.md §5.3).
 *
 * Adapter implementing ProductStockGate port against a Drizzle transaction.
 * Replaces `PrismaProductStockGate` for the Prisma → Drizzle migration.
 *
 * Performs the SELECT … FOR UPDATE row lock inside the supplied tx.
 * Only mutates via the tx — never via the top-level db.
 *
 * Consumed by:
 *   - `orders/application/receive-order.ts` (atomic receive flow)
 */

import { randomUUID } from 'node:crypto';
import type {
  ProductStockGate,
  StockMovementRecorded,
} from '../domain/ports/product-stock-gate.js';
import type { TransactionContext } from '../../shared/domain/ports/unit-of-work.js';

export class DrizzleProductStockGate implements ProductStockGate {
  async txIncrementStock(
    tx: unknown,
    args: {
      productId: string;
      type: 'ENTRADA' | 'SALIDA';
      quantity: number;
      reason: string;
      userId: string;
    },
  ): Promise<StockMovementRecorded> {
    const ctx = tx as TransactionContext;

    // Step 1: Lock the product row (SELECT … FOR UPDATE)
    const product = await ctx.findProductForUpdate(args.productId);
    if (!product) {
      throw new Error(`Product not found: ${args.productId}`);
    }

    // Step 2: Compute new stock
    const delta = args.type === 'ENTRADA' ? args.quantity : -args.quantity;
    const stockAfter = product.stock + delta;

    // Step 3: Insert StockMovement (append-only, BR-6).
    const now = new Date();
    await ctx.insertStockMovement({
      id: randomUUID(),
      productId: args.productId,
      type: args.type,
      quantity: args.quantity,
      reason: args.reason,
      userId: args.userId,
      stockAfter,
      createdAt: now,
    });

    // Step 4: Update product stock
    await ctx.updateProductStock(args.productId, stockAfter);

    return {
      productId: args.productId,
      type: args.type,
      quantity: args.quantity,
      stockAfter,
      stockMin: product.stockMin,
      occurredAt: now,
    };
  }
}

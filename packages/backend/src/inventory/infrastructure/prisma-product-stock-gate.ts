/**
 * Inventory BC — PrismaProductStockGate (PR 2b, design.md §5.3).
 *
 * Adapter implementing ProductStockGate port against a Prisma transaction
 * client. Performs the SELECT … FOR UPDATE row lock inside the supplied tx.
 * Only mutates via the tx — never via the top-level PrismaClient.
 *
 * Consumed by:
 *   - `orders/application/receive-order.ts` (PR 2c, atomic receive flow)
 */

import { randomUUID } from 'node:crypto';
import type {
  ProductStockGate,
  StockMovementRecorded,
} from '../domain/ports/product-stock-gate.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';

/**
 * Prisma 5.x: model accessors are class getters that TS Omit strips.
 * Use any for tx type — runtime object IS the transaction proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

export class PrismaProductStockGate implements ProductStockGate {
  async txIncrementStock(
    tx: TxClient,
    args: {
      productId: string;
      type: 'ENTRADA' | 'SALIDA';
      quantity: number;
      reason: string;
      userId: string;
    },
  ): Promise<StockMovementRecorded> {
    // Step 1: Lock the product row (SELECT … FOR UPDATE)
    const rows = await tx.$queryRaw<Array<{ id: string; stock: number; stock_min: number }>>`
      SELECT id, stock, stock_min FROM products WHERE id = ${args.productId}::uuid FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new ProductNotFoundError(args.productId);

    // Step 2: Compute new stock
    const delta = args.type === 'ENTRADA' ? args.quantity : -args.quantity;
    const stockAfter = Number(row.stock) + delta;

    // Step 3: Insert StockMovement (append-only, BR-6)
    const now = new Date();
    await tx.stockMovement.create({
      data: {
        id: randomUUID(),
        productId: args.productId,
        type: args.type,
        quantity: args.quantity,
        reason: args.reason,
        userId: args.userId,
        createdAt: now,
      },
    });

    // Step 4: Update product stock
    await tx.product.update({
      where: { id: args.productId },
      data: { stock: stockAfter },
    });

    return {
      productId: args.productId,
      type: args.type,
      quantity: args.quantity,
      stockAfter,
      stockMin: Number(row.stock_min),
      occurredAt: now,
    };
  }
}

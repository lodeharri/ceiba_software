/**
 * Inventory BC — ProductStockGate port (PR 2b, design.md §5.3).
 *
 * Port interface owned by the `inventory` BC. Consumed by:
 *   - `orders/application/receive-order.ts` (PR 2c, atomic receive)
 *
 * The port must be called inside an existing prisma $transaction.
 * It performs the SELECT ... FOR UPDATE row lock.
 */

export interface StockMovementRecorded {
  productId: string;
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  stockAfter: number;
  stockMin: number;
  occurredAt: Date;
}

export interface ProductStockGate {
  /**
   * Atomically inserts the StockMovement row and updates products.stock.
   * MUST be called inside an existing prisma $transaction; it does NOT
   * start its own. Performs the SELECT ... FOR UPDATE row lock.
   */
  txIncrementStock(
    tx: unknown,
    args: {
      productId: string;
      type: 'ENTRADA' | 'SALIDA';
      quantity: number;
      reason: string;
      userId: string;
    },
  ): Promise<StockMovementRecorded>;
}

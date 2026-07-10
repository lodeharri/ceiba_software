/**
 * Alerts BC — AlertCloserPort (PR 2b, design.md §5.3).
 *
 * Port interface owned by the `alerts` BC. Consumed by:
 *   - `inventory/application/stock-mutation-service.ts` (recovery path)
 *   - `orders/application/receive-order.ts` (PR 2c, atomic receive)
 *
 * The port must be idempotent: if no active alert exists for the product,
 * the call is a no-op (returns null).
 */

export interface AlertCloserPort {
  /**
   * Closes the active alert for productId IF it exists AND newStock > stockMin.
   * MUST be called inside an existing prisma $transaction.
   *
   * @returns The closed alert id, or null if no alert was open / condition not met.
   */
  txCloseIfOpenAndAboveMin(
    tx: unknown,
    args: { productId: string; newStock: number; stockMin: number },
  ): Promise<{ alertId: string } | null>;
}

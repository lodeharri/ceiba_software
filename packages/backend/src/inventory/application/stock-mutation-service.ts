/**
 * Inventory BC — StockMutationService (PR 1.2, design.md §6.3).
 *
 * The core stock mutation use case. Uses UnitOfWork for atomic transactions
 * (BEGIN/COMMIT/ROLLBACK) and SELECT … FOR UPDATE row lock.
 *
 * Flow per design.md §6.3:
 *   1. Lock the product row via SELECT … FOR UPDATE
 *   2. Compute delta (ENTRADA → +, SALIDA → −) per BR-D8
 *   3. Reject if newStock < 0 (BR-1: STOCK_WOULD_GO_NEGATIVE)
 *   4. Insert StockMovement row (append-only, BR-6)
 *   5. Update Product.stock
 *   6. If newStock <= stockMin and no existing ACTIVA alert → create one
 *   7. If newStock > stockMin → call AlertCloserPort.txCloseIfOpenAndAboveMin
 *
 * The AlertCloserPort is owned by the `alerts` BC; we depend on the port
 * interface, not the implementation (RISK-001, §5.3).
 */

import { randomUUID } from 'node:crypto';
import type { UnitOfWork } from '../../shared/domain/ports/unit-of-work.js';
import type { AlertCloserPort } from '../../alerts/domain/ports/alert-closer-port.js';
import type { TransactionContext } from '../../shared/domain/ports/unit-of-work.js';
import { StockWouldGoNegativeError } from '../domain/errors/stock-would-go-negative.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';

export interface RecordMovementInput {
  productId: string;
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  reason: string;
  userId: string;
}

/**
 * Return type of `StockMutationService.record()`.
 * Matches `movementSchema` (packages/shared) so the frontend
 * Zod validation passes on the HTTP response body.
 */
export interface RecordMovementResult {
  id: string;
  productId: string;
  type: 'ENTRADA' | 'SALIDA';
  quantity: number;
  reason: string;
  userId: string;
  stockAfter: number;
  createdAt: string; // ISO-8601 datetime string
}

export class StockMutationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly alertCloserPort: AlertCloserPort,
  ) {}

  async record(input: RecordMovementInput): Promise<RecordMovementResult> {
    return this.uow.execute(async (ctx: TransactionContext) => {
      // Step 1: Lock the product row (ADR-2, RISK-002)
      const product = await ctx.findProductForUpdate(input.productId);
      if (!product) throw new ProductNotFoundError(input.productId);

      // Step 2: Compute delta (BR-D8)
      const delta = input.type === 'ENTRADA' ? input.quantity : -input.quantity;
      const newStock = product.stock + delta;

      // Step 3: Reject if stock would go negative (BR-1)
      if (newStock < 0) {
        throw new StockWouldGoNegativeError({
          currentStock: product.stock,
          requested: input.quantity,
          shortBy: -newStock,
        });
      }

      // Step 4: Insert StockMovement (append-only, BR-6)
      const createdAt = new Date();
      const movementId = randomUUID();
      await ctx.insertStockMovement({
        id: movementId,
        productId: input.productId,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
        userId: input.userId,
        stockAfter: newStock,
        createdAt,
      });

      // Step 5: Update product stock
      await ctx.updateProductStock(input.productId, newStock);

      // Step 6: If crossing below min AND no existing active alert → create one (BR-4)
      if (newStock <= product.stockMin) {
        await ctx.openAlertIfAbsent({
          id: randomUUID(),
          productId: input.productId,
          type: 'STOCK_BAJO',
        });
      }

      // Step 7: If newStock strictly exceeds stockMin → close active alert (BR-3 recovery)
      if (newStock > product.stockMin) {
        await this.alertCloserPort.txCloseIfOpenAndAboveMin(ctx as unknown, {
          productId: input.productId,
          newStock,
          stockMin: product.stockMin,
        });
      }

      return {
        id: movementId,
        productId: input.productId,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
        userId: input.userId,
        stockAfter: newStock,
        createdAt: createdAt.toISOString(),
      };
    });
  }
}

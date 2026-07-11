/**
 * Inventory BC — StockMutationService (PR 2b, design.md §6.3).
 *
 * The core stock mutation use case. Uses `prisma.$transaction` with
 * `ReadCommitted` isolation (ADR-2) and `SELECT … FOR UPDATE` row lock.
 *
 * Flow per design.md §6.3:
 *   1. Lock the product row via `$queryRaw` SELECT … FOR UPDATE
 *   2. Compute delta (ENTRADA → +, SALIDA → −) per BR-D8
 *   3. Reject if newStock < 0 (BR-1: STOCK_WOULD_GO_NEGATIVE)
 *   4. Insert StockMovement row (append-only, BR-6)
 *   5. Update Product.stock
 *   6. If newStock <= stockMin and no existing ACTIVA alert → create one
 *   7. If newStock > stockMin → call AlertCloserPort.txCloseIfOpenAndAboveMin
 *
 * The AlertCloserPort is owned by the `alerts` BC; we depend on the port
 * interface, not the implementation (RISK-001, §5.5).
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AlertCloserPort } from '../../alerts/domain/ports/alert-closer-port.js';
import { StockWouldGoNegativeError } from '../domain/errors/stock-would-go-negative.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';

/**
 * Prisma 5.x: model accessors (stockMovement, alert, product) are class
 * getters that TypeScript's structural type system does not expose as
 * properties. The `TransactionClient` type (`Omit<PrismaClient, ...>`)
 * inherits this limitation. We use `any` here with explicit JSDoc — the
 * runtime object IS the PrismaClient transaction proxy with all model
 * delegates available. Each usage site validates the specific model access.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

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
  createdAt: string; // ISO-8601 datetime string (Prisma Date → serialized by handler)
}

/**
 * Typed helper: lock a product row via SELECT … FOR UPDATE.
 * Extracted to a single function so the raw SQL appears once (Task 13 REFACTOR).
 */
async function lockProductRow(
  tx: TxClient,
  productId: string,
): Promise<{ id: string; stock: number; stock_min: number }> {
  const rows = await tx.$queryRaw<Array<{ id: string; stock: number; stock_min: number }>>`
    SELECT id, stock, stock_min FROM products WHERE id = ${productId}::uuid FOR UPDATE
  `;
  return rows[0]!;
}

/**
 * Helper: try to create an ACTIVA alert, swallowing P2002 (unique_violation)
 * from the BR-4 partial unique index. This is belt-and-suspenders: the
 * precondition check + the index together ensure at most one active alert.
 * Extracted to a single function (Task 13 REFACTOR).
 */
async function openAlertIfAbsent(tx: TxClient, productId: string): Promise<void> {
  try {
    await tx.alert.create({
      data: {
        id: randomUUID(),
        productId,
        type: 'STOCK_BAJO',
        status: 'ACTIVA',
        createdAt: new Date(),
      },
    });
  } catch (e: unknown) {
    // P2002 = unique_violation from BR-4 partial index → swallow.
    // ALL other errors (including network/connection) → rethrow.
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code: string }).code === 'P2002'
    ) {
      return;
    }
    throw e;
  }
}

export class StockMutationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly alertCloserPort: AlertCloserPort,
  ) {}

  async record(input: RecordMovementInput): Promise<RecordMovementResult> {
    return this.prisma.$transaction(
      async (txRaw) => {
        const tx = txRaw as TxClient;
        // Step 1: Lock the product row (ADR-2, RISK-002)
        const row = await lockProductRow(tx, input.productId);
        if (!row) throw new ProductNotFoundError(input.productId);

        // Step 2: Compute delta (BR-D8)
        const delta = input.type === 'ENTRADA' ? input.quantity : -input.quantity;
        const newStock = Number(row.stock) + delta;

        // Step 3: Reject if stock would go negative (BR-1)
        if (newStock < 0) {
          throw new StockWouldGoNegativeError({
            currentStock: Number(row.stock),
            requested: input.quantity,
            shortBy: -newStock,
          });
        }

        // Step 4: Insert StockMovement (append-only, BR-6)
        // `stockAfter` is denormalized at insert time per
        // shared/src/schemas/inventory/movement.ts so list views do not
        // need to walk the ledger to compute it.
        const movement = await tx.stockMovement.create({
          data: {
            id: randomUUID(),
            productId: input.productId,
            type: input.type,
            quantity: input.quantity,
            reason: input.reason,
            userId: input.userId,
            stockAfter: newStock,
            createdAt: new Date(),
          },
        });

        // Step 5: Update product stock
        await tx.product.update({
          where: { id: input.productId },
          data: { stock: newStock },
        });

        // Step 6: If crossing below min AND no existing active alert → create one
        // (BR-4: try/catch P2002 swallows duplicate from partial unique index)
        if (newStock <= row.stock_min) {
          await openAlertIfAbsent(tx, input.productId);
        }

        // Step 7: If newStock strictly exceeds stockMin → close active alert (BR-3 recovery)
        if (newStock > row.stock_min) {
          await this.alertCloserPort.txCloseIfOpenAndAboveMin(tx, {
            productId: input.productId,
            newStock,
            stockMin: row.stock_min,
          });
        }

        return {
          id: movement.id,
          productId: movement.productId,
          type: movement.type as 'ENTRADA' | 'SALIDA',
          quantity: movement.quantity,
          reason: movement.reason,
          userId: movement.userId,
          stockAfter: movement.stockAfter,
          createdAt: movement.createdAt.toISOString(),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}

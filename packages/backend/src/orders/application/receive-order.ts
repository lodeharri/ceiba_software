/**
 * Orders BC — ReceiveOrderUseCase (PR 2c, orders/spec.md, ADR-3).
 *
 * THE FOUR-STEP ATOMIC FLOW inside `prisma.$transaction`:
 *
 *   1. `orderRepository.txUpdate(id, 'RECIBIDA')`
 *      First write inside tx — validates the state transition.
 *
 *   2. `productStockGate.txIncrementStock(tx, productId, ENTRADA, qty, reason, userId)`
 *      Re-locks the product row, inserts the StockMovement, updates Product.stock.
 *
 *   3. `alertCloserPort.txCloseIfOpenAndAboveMin(tx, productId, newStock, stockMin)`
 *      Closes ACTIVA alert iff newStock > stockMin (idempotent — null if no alert).
 *
 *   4. Returns `{ order, stockAfter, closedAlertId? }`.
 *
 * DUPLICATE-RECEIVE PROTECTION (RISK-W07):
 *   A second POST /receive on an already-RECIBIDA order throws
 *   OrderInvalidTransitionError (409). The state machine IS the guard;
 *   Idempotency-Key is NOT used for this path.
 *
 * ROLLBACK BEHAVIOR:
 *   If step 2 or 3 throws, the entire prisma.$transaction rolls back.
 *   Step 1 has already set status to RECIBIDA — but the tx rollback restores
 *   it. No movement, no stock change, no alert mutation persists.
 */

import type { PrismaClient } from '@prisma/client';
import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductStockGate } from '../domain/ports/product-stock-gate.js';
import type { AlertCloserPort } from '../domain/ports/alert-closer-port.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

export interface ReceiveOrderResult {
  orderId: string;
  status: 'RECIBIDA';
  stockAfter: number;
  closedAlertId: string | null;
  receivedAt: string;
}

export class ReceiveOrderUseCase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly orderRepo: OrderRepository,
    private readonly stockGate: ProductStockGate,
    private readonly alertCloser: AlertCloserPort,
  ) {}

  async execute(orderId: string, reason: string, userId: string): Promise<ReceiveOrderResult> {
    // Step 1: Validate state machine pre-condition
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    if (order.status !== 'APROBADA') {
      throw new OrderInvalidTransitionError(order.status, 'receive');
    }

    // Steps 2-4 inside one atomic transaction
    return this.prisma
      .$transaction(
        async (txRaw) => {
          const tx = txRaw as TxClient;

          // Step 2: txUpdate order to RECIBIDA
          const updatedOrder = await this.orderRepo.txUpdate(tx, orderId, 'RECIBIDA');

          // Step 3: Increment stock via inventory gate (re-locks product row)
          const recorded = await this.stockGate.txIncrementStock(tx, {
            productId: order.productId,
            type: 'ENTRADA',
            quantity: order.quantity,
            reason,
            userId,
          });

          // Step 4: Close alert if stock recovered above minimum
          const closeResult = await this.alertCloser.txCloseIfOpenAndAboveMin(tx, {
            productId: order.productId,
            newStock: recorded.stockAfter,
            stockMin: recorded.stockMin,
          });

          return {
            order: updatedOrder,
            stockAfter: recorded.stockAfter,
            closedAlertId: closeResult?.alertId ?? null,
          };
        },
        { isolationLevel: 'ReadCommitted' },
      )
      .then((result) => ({
        orderId: result.order.id,
        status: result.order.status as 'RECIBIDA',
        stockAfter: result.stockAfter,
        closedAlertId: result.closedAlertId,
        receivedAt: result.order.receivedAt!.toISOString(),
      }));
  }
}

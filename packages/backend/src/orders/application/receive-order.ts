/**
 * Orders BC — ReceiveOrderUseCase (PR 1.2, orders/spec.md, ADR-3).
 *
 * THE FOUR-STEP ATOMIC FLOW inside `uow.execute()`:
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
 *   If step 2 or 3 throws, the entire transaction rolls back.
 *   Step 1 has already set status to RECIBIDA — but the tx rollback restores
 *   it. No movement, no stock change, no alert mutation persists.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { ProductStockGate } from '../domain/ports/product-stock-gate.js';
import type { AlertCloserPort } from '../domain/ports/alert-closer-port.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';
import { OrderProductInconsistencyError } from '../domain/errors/order-product-inconsistency.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';
import type { UnitOfWork, TransactionContext } from '../../shared/domain/ports/unit-of-work.js';

export interface ReceiveOrderResult {
  order: OrderReadModel;
  stockAfter: number;
  closedAlertId: string | null;
}

export class ReceiveOrderUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
    private readonly stockGate: ProductStockGate,
    private readonly alertCloser: AlertCloserPort,
  ) {}

  async execute(orderId: string, reason: string, userId: string): Promise<ReceiveOrderResult> {
    // Early validation: find the order and product BEFORE entering the
    // transaction. If the product has been deleted since approval, fail
    // fast — no side effects, no orphaned stock movements.
    const existing = await this.orderRepo.findById(orderId);
    if (!existing) {
      throw new OrderNotFoundError(orderId);
    }
    const product = await this.productRepo.findById(existing.productId);
    if (!product) {
      throw new OrderProductInconsistencyError(existing.id, existing.productId);
    }

    // All steps inside one atomic transaction to prevent TOCTOU race conditions
    return this.uow.execute(async (ctx: TransactionContext) => {
      // Step 1: Find and validate state machine pre-condition inside tx
      const order = await this.orderRepo.findByIdTx(ctx as unknown, orderId);
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      if (order.status !== 'APROBADA') {
        throw new OrderInvalidTransitionError(order.status, 'receive');
      }

      // Step 2: txUpdate order to RECIBIDA
      const updatedOrder = await this.orderRepo.txUpdate(ctx as unknown, orderId, 'RECIBIDA');

      // Step 3: Increment stock via inventory gate (re-locks product row)
      const recorded = await this.stockGate.txIncrementStock(ctx, {
        productId: order.productId,
        type: 'ENTRADA',
        quantity: order.quantity,
        reason,
        userId,
      });

      // Step 4: Close alert if stock recovered above minimum
      const closeResult = await this.alertCloser.txCloseIfOpenAndAboveMin(ctx, {
        productId: order.productId,
        newStock: recorded.stockAfter,
        stockMin: recorded.stockMin,
      });

      // Step 5: Compose the flat read model with the pre-fetched product
      // snapshot. `product` is captured by closure from the early-validation
      // step above, so we never produce undefined productName / productSku.
      return {
        order: composeOrder(updatedOrder, product),
        stockAfter: recorded.stockAfter,
        closedAlertId: closeResult?.alertId ?? null,
      };
    });
  }
}

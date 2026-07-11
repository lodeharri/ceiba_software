/**
 * Orders BC — CreateOrderUseCase (PR 2c, orders/spec.md).
 *
 * Flow:
 *   1. Validate product exists (via ProductReadRepository)
 *   2. Validate quantity >= 2 * stockMin (BR-2)
 *   3. Validate fromAlertId if provided (via AlertReadRepository)
 *   4. Snapshot supplier (Q-P3 — write-once, never refreshed)
 *   5. Persist via OrderRepository
 *   6. Compose the flat `Order` read model (productName / productSku)
 *      so the frontend can `unshift` the response into the orders list
 *      without producing undefined cells. Mirrors the alerts BC `composeAlert`
 *      pattern.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import type { AlertReadRepository } from '../domain/ports/alert-read-repository.js';
import { OrderQtyBelowPolicyError } from '../domain/errors/order-qty-below-policy.js';
import { AlertNotActiveError } from '../domain/errors/alert-not-active.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';

export interface CreateOrderInput {
  productId: string;
  quantity: number;
  fromAlertId?: string;
  createdBy: string;
}

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
    private readonly alertRepo: AlertReadRepository,
  ) {}

  async execute(input: CreateOrderInput): Promise<OrderReadModel> {
    // Step 1: Validate product exists and get stockMin + supplier
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      throw new OrderNotFoundError(input.productId);
    }

    // Step 2: Validate quantity policy (BR-2)
    const minimum = 2 * product.stockMin;
    if (input.quantity < minimum) {
      throw new OrderQtyBelowPolicyError(input.quantity, minimum, product.stockMin);
    }

    // Step 3: Validate fromAlertId if provided
    let fromAlertId: string | null = null;
    if (input.fromAlertId) {
      const alert = await this.alertRepo.findById(input.fromAlertId);
      if (!alert) {
        throw new AlertNotActiveError(input.fromAlertId, 'missing');
      }
      if (alert.status === 'RESUELTA') {
        throw new AlertNotActiveError(input.fromAlertId, 'resolved');
      }
      if (alert.productId !== input.productId) {
        throw new AlertNotActiveError(input.fromAlertId, 'product_mismatch');
      }
      fromAlertId = input.fromAlertId;
    }

    // Step 4: Snapshot supplier (Q-P3 — write-once)
    const supplierSnapshot = product.supplier;

    // Step 5: Persist
    const order = await this.orderRepo.create({
      id: crypto.randomUUID(),
      productId: input.productId,
      quantity: input.quantity,
      status: 'PENDIENTE',
      supplierSnapshot,
      fromAlertId,
      reason: null,
      createdBy: input.createdBy,
      receivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Step 6: Compose the flat read model. The product was fetched at step 1
    // and is guaranteed to exist (TS narrows after the throw above), so we
    // can pass it straight to composeOrder without a null check.
    return composeOrder(order, product);
  }
}

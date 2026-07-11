/**
 * Orders BC — ApproveOrderUseCase (PR 2c, orders/spec.md).
 *
 * Transitions PENDIENTE → APROBADA (BR-D1).
 * Uses `updateStatus` (not `txUpdate`) since this is a simple single-row update.
 * Throws OrderInvalidTransitionError on any other status (409).
 *
 * The response is the COMPOSED flat `Order` read model (productName /
 * productSku from the joined product) so the frontend `upsertInList` in
 * the orders store can replace the row without producing undefined cells.
 * Mirrors the alerts BC `composeAlert` pattern.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';
import { OrderProductInconsistencyError } from '../domain/errors/order-product-inconsistency.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';

export class ApproveOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
  ) {}

  async execute(orderId: string): Promise<OrderReadModel> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    if (order.status !== 'PENDIENTE') {
      throw new OrderInvalidTransitionError(order.status, 'approve');
    }

    // Single-row update — no transaction needed.
    // Uses `updateStatus` (not `txUpdate` which is reserved for the receive flow).
    const updated = await this.orderRepo.updateStatus(orderId, 'APROBADA');

    // Compose the flat read model with the product snapshot. If the product
    // was deleted between order creation and approval, surface a 422 rather
    // than returning a partial shape with undefined productName/productSku.
    const product = await this.productRepo.findById(updated.productId);
    if (!product) {
      throw new OrderProductInconsistencyError(updated.id, updated.productId);
    }
    return composeOrder(updated, product);
  }
}

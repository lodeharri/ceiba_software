/**
 * Orders BC — RejectOrderUseCase (PR 2c, orders/spec.md, BR-D2).
 *
 * Transitions PENDIENTE → RECHAZADA with a reason >= 10 chars.
 * Throws RejectionReasonTooShortError on short reason (422).
 * Throws OrderInvalidTransitionError on wrong status (409).
 *
 * The response is the COMPOSED flat `Order` read model (productName /
 * productSku from the joined product). Mirrors the alerts BC `composeAlert`
 * pattern.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import { RejectionReasonTooShortError } from '../domain/errors/rejection-reason-too-short.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';
import { OrderProductInconsistencyError } from '../domain/errors/order-product-inconsistency.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';

export interface RejectOrderInput {
  orderId: string;
  reason: string;
}

export class RejectOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
  ) {}

  async execute(input: RejectOrderInput): Promise<OrderReadModel> {
    if (typeof input.reason !== 'string' || input.reason.length < 10) {
      throw new RejectionReasonTooShortError(
        typeof input.reason === 'string' ? input.reason.length : 0,
      );
    }

    const order = await this.orderRepo.findById(input.orderId);
    if (!order) {
      throw new OrderNotFoundError(input.orderId);
    }
    if (order.status !== 'PENDIENTE') {
      throw new OrderInvalidTransitionError(order.status, 'reject');
    }

    const updated = await this.orderRepo.updateStatus(input.orderId, 'RECHAZADA', input.reason);

    // Compose the flat read model with the product snapshot. If the product
    // was deleted between order creation and rejection, surface a 422 rather
    // than returning a partial shape with undefined productName/productSku.
    const product = await this.productRepo.findById(updated.productId);
    if (!product) {
      throw new OrderProductInconsistencyError(updated.id, updated.productId);
    }
    return composeOrder(updated, product);
  }
}

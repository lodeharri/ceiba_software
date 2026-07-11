/**
 * Orders BC — GetOrderUseCase (PR 2c, orders/spec.md).
 *
 * Returns a single order by id, composed via `composeOrder(order, product)`
 * to match the canonical flat `Order` read model in `packages/shared` —
 * productName / productSku are required by the schema.
 *
 * If the product has been deleted since the order was created, throws
 * OrderProductInconsistencyError (422) rather than returning a partial
 * shape with undefined productName / productSku. Mirrors `GetAlert` in
 * the alerts BC.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';
import { OrderProductInconsistencyError } from '../domain/errors/order-product-inconsistency.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';

export interface GetOrderResult {
  order: OrderReadModel;
}

export class GetOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
  ) {}

  async execute(orderId: string): Promise<GetOrderResult> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    const product = await this.productRepo.findById(order.productId);
    if (!product) {
      throw new OrderProductInconsistencyError(order.id, order.productId);
    }
    return { order: composeOrder(order, product) };
  }
}

/**
 * Orders BC — ListOrdersUseCase (PR 2c, orders/spec.md).
 *
 * Lists orders with optional filters (productId, status) and pagination.
 * Ordered by createdAt DESC.
 *
 * Each row is composed via `composeOrder(order, product)` so the response
 * matches the canonical flat `Order` read model in `packages/shared` —
 * productName / productSku are required by the schema, never undefined.
 * Orders whose product has been deleted since creation are silently
 * dropped (the partial unique constraints in the schema make this race
 * narrow; surfacing a 422 for every dropped row in a list would be
 * hostile UX). This mirrors the alerts BC `composeAlert` list pattern.
 */

import type { OrderRepository, ListOrdersOptions } from '../domain/ports/order-repository.js';
import type { ProductReadRepository } from '../domain/ports/product-read-repository.js';
import { composeOrder, type OrderReadModel } from './compose-order.js';

export interface ListOrdersInput {
  productId?: string;
  status?: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA';
  page: number;
  size: number;
}

export interface ListOrdersResult {
  items: OrderReadModel[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

export class ListOrdersUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductReadRepository,
  ) {}

  async execute(input: ListOrdersInput): Promise<ListOrdersResult> {
    const opts: ListOrdersOptions = {
      page: Math.max(1, input.page),
      size: Math.max(1, Math.min(100, input.size)),
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    const result = await this.orderRepo.list(opts);

    // Compose each row. Drop orders whose product has been deleted.
    const items: OrderReadModel[] = [];
    for (const order of result.items) {
      const product = await this.productRepo.findById(order.productId);
      if (product) {
        items.push(composeOrder(order, product));
      }
    }

    return {
      items,
      page: result.page,
      size: result.size,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

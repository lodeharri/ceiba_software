/**
 * Orders BC — GetOrderUseCase (PR 2c, orders/spec.md).
 *
 * Returns a single order by id or throws 404.
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';

export interface OrderReadModel {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  supplierSnapshot: string;
  fromAlertId: string | null;
  rejectionReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
}

export interface GetOrderResult {
  order: OrderReadModel;
}

function toReadModel(p: {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  supplierSnapshot: string;
  fromAlertId: string | null;
  reason: string | null;
  createdBy: string;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OrderReadModel {
  return {
    id: p.id,
    productId: p.productId,
    quantity: p.quantity,
    status: p.status,
    supplierSnapshot: p.supplierSnapshot,
    fromAlertId: p.fromAlertId,
    rejectionReason: p.reason,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    receivedAt: p.receivedAt?.toISOString() ?? null,
  };
}

export class GetOrderUseCase {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(orderId: string): Promise<GetOrderResult> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return { order: toReadModel(order as Parameters<typeof toReadModel>[0]) };
  }
}

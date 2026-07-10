/**
 * Orders BC — ApproveOrderUseCase (PR 2c, orders/spec.md).
 *
 * Transitions PENDIENTE → APROBADA (BR-D1).
 * Uses `updateStatus` (not `txUpdate`) since this is a simple single-row update.
 * Throws OrderInvalidTransitionError on any other status (409).
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';

export interface ApproveOrderResult {
  id: string;
  status: 'APROBADA';
  updatedAt: string;
}

export class ApproveOrderUseCase {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(orderId: string): Promise<ApproveOrderResult> {
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

    return {
      id: updated.id,
      status: updated.status as 'APROBADA',
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

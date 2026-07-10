/**
 * Orders BC — RejectOrderUseCase (PR 2c, orders/spec.md, BR-D2).
 *
 * Transitions PENDIENTE → RECHAZADA with a reason >= 10 chars.
 * Throws RejectionReasonTooShortError on short reason (422).
 * Throws OrderInvalidTransitionError on wrong status (409).
 */

import type { OrderRepository } from '../domain/ports/order-repository.js';
import { RejectionReasonTooShortError } from '../domain/errors/rejection-reason-too-short.js';
import { OrderInvalidTransitionError } from '../domain/errors/order-invalid-transition.js';
import { OrderNotFoundError } from '../domain/errors/order-not-found.js';

export interface RejectOrderInput {
  orderId: string;
  reason: string;
}

export interface RejectOrderResult {
  id: string;
  status: 'RECHAZADA';
  reason: string;
  updatedAt: string;
}

export class RejectOrderUseCase {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: RejectOrderInput): Promise<RejectOrderResult> {
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

    return {
      id: updated.id,
      status: updated.status as 'RECHAZADA',
      reason: updated.reason ?? '',
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

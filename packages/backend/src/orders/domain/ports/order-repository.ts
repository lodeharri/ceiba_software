/**
 * Orders BC — OrderRepository port (PR 2c, orders/spec.md).
 *
 * Port interface for the PurchaseOrder aggregate. Consumed by:
 *   - `orders/application/create-order.ts`
 *   - `orders/application/approve-order.ts`
 *   - `orders/application/reject-order.ts`
 *   - `orders/application/receive-order.ts`
 *   - `orders/application/list-orders.ts`
 *   - `orders/application/get-order.ts`
 *
 * Implementation: `orders/infrastructure/prisma-order-repository.ts`.
 */

import type { PurchaseOrderProps } from '../purchase-order.js';

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

export type OrderStatusFilter = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA';

export interface ListOrdersOptions {
  productId?: string;
  status?: OrderStatusFilter;
  page: number;
  size: number;
}

export interface OrderRepository {
  create(props: PurchaseOrderProps): Promise<PurchaseOrderProps>;
  findById(id: string): Promise<PurchaseOrderProps | null>;
  list(opts: ListOrdersOptions): Promise<Page<PurchaseOrderProps>>;

  /**
   * Simple status update for single-row transitions (approve / reject).
   * The `reason` field is set when transitioning to RECHAZADA.
   * Uses a prisma transaction internally.
   */
  updateStatus(id: string, status: OrderStatusFilter, reason?: string): Promise<PurchaseOrderProps>;

  /**
   * Atomically update the order status inside a supplied Prisma transaction.
   * This is the ONLY public write path for the receive flow (ADR-3 mitigation).
   * MUST be called inside an existing `prisma.$transaction`.
   */
  txUpdate(tx: unknown, id: string, status: OrderStatusFilter): Promise<PurchaseOrderProps>;
}

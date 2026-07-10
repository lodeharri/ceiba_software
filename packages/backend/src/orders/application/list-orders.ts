/**
 * Orders BC — ListOrdersUseCase (PR 2c, orders/spec.md).
 *
 * Lists orders with optional filters (productId, status) and pagination.
 * Ordered by createdAt DESC.
 */

import type { OrderRepository, ListOrdersOptions } from '../domain/ports/order-repository.js';

export interface ListOrdersInput {
  productId?: string;
  status?: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA';
  page: number;
  size: number;
}

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

export interface ListOrdersResult {
  items: OrderReadModel[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
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

export class ListOrdersUseCase {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: ListOrdersInput): Promise<ListOrdersResult> {
    const opts: ListOrdersOptions = {
      page: Math.max(1, input.page),
      size: Math.max(1, Math.min(100, input.size)),
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    const result = await this.orderRepo.list(opts);
    return {
      items: result.items.map(toReadModel),
      page: result.page,
      size: result.size,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

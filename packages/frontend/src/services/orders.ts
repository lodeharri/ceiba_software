/**
 * Orders service — MercadoExpress SPA.
 */
import { http } from './http';
import type { Order } from '@mercadoexpress/shared/schemas/orders/order.js';
import type { CreateOrderRequest } from '@mercadoexpress/shared/schemas/orders/create-order.js';
import type { ApproveOrderRequest } from '@mercadoexpress/shared/schemas/orders/approve-order.js';
import type { RejectOrderRequest } from '@mercadoexpress/shared/schemas/orders/reject-order.js';
import type { ReceiveOrderRequest } from '@mercadoexpress/shared/schemas/orders/receive-order.js';
import type { PageEnvelope } from '@mercadoexpress/shared/schemas/common/page.js';
import { sha256OfSortedJson } from '@/utils/idempotency-hash';

export type {
  Order,
  CreateOrderRequest,
  ApproveOrderRequest,
  RejectOrderRequest,
  ReceiveOrderRequest,
};

export interface ListOrdersOptions {
  status?: string;
  page?: number;
  size?: number;
}

export async function listOrders(opts: ListOrdersOptions = {}): Promise<PageEnvelope<Order>> {
  return http<PageEnvelope<Order>>('/orders', {
    query: {
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      page: opts.page ?? 1,
      size: opts.size ?? 20,
    },
  });
}

export async function getOrder(id: string): Promise<Order> {
  return http<Order>(`/orders/${id}`);
}

export async function createOrder(input: CreateOrderRequest): Promise<Order> {
  return http<Order>('/orders', {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

export async function approveOrder(id: string, input: ApproveOrderRequest): Promise<Order> {
  return http<Order>(`/orders/${id}/approve`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

export async function rejectOrder(id: string, input: RejectOrderRequest): Promise<Order> {
  return http<Order>(`/orders/${id}/reject`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

export async function receiveOrder(id: string, input: ReceiveOrderRequest): Promise<Order> {
  return http<Order>(`/orders/${id}/receive`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

async function idempotencyHeader(body: unknown): Promise<HeadersInit> {
  const key = await sha256OfSortedJson(body);
  return { 'Idempotency-Key': key };
}

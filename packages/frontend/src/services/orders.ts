/**
 * Orders service — MercadoExpress SPA.
 *
 * Every response is validated against the shared Zod schemas so a
 * contract drift between backend and frontend (e.g. `quantity` renamed
 * to `units`) fails LOUDLY at the boundary instead of corrupting
 * downstream stores with a poisoned order object.
 *
 * Mirrors the `auth.ts` Zod safeParse pattern.
 */
import { http } from './http';
import {
  orderSchema,
  pageEnvelopeSchema,
  type Order,
  type CreateOrderRequest,
  type ApproveOrderRequest,
  type RejectOrderRequest,
  type ReceiveOrderRequest,
  type PageEnvelope,
} from '@mercadoexpress/shared';
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

export class InvalidOrdersResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidOrdersResponseError';
  }
}

export async function listOrders(opts: ListOrdersOptions = {}): Promise<PageEnvelope<Order>> {
  const raw = await http<unknown>('/orders', {
    query: {
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      page: opts.page ?? 1,
      size: opts.size ?? 20,
    },
  });

  const parsed = pageEnvelopeSchema(orderSchema).safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] listOrders response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió una lista de pedidos inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function getOrder(id: string): Promise<Order> {
  const raw = await http<unknown>(`/orders/${id}`);

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] getOrder response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió un pedido inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function createOrder(input: CreateOrderRequest): Promise<Order> {
  const raw = await http<unknown>('/orders', {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] createOrder response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió un pedido creado inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function approveOrder(id: string, input: ApproveOrderRequest): Promise<Order> {
  const raw = await http<unknown>(`/orders/${id}/approve`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] approveOrder response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió un pedido aprobado inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function rejectOrder(id: string, input: RejectOrderRequest): Promise<Order> {
  const raw = await http<unknown>(`/orders/${id}/reject`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] rejectOrder response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió un pedido rechazado inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function receiveOrder(id: string, input: ReceiveOrderRequest): Promise<Order> {
  const raw = await http<unknown>(`/orders/${id}/receive`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[orders] receiveOrder response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidOrdersResponseError(
      'El servidor devolvió un pedido recibido inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function idempotencyHeader(body: unknown): Promise<HeadersInit> {
  const key = await sha256OfSortedJson(body);
  return { 'Idempotency-Key': key };
}

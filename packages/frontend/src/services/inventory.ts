/**
 * Inventory service — MercadoExpress SPA.
 */
import { http } from './http';
import type { Movement } from '@mercadoexpress/shared/schemas/inventory/movement.js';
import type { CreateMovementRequest } from '@mercadoexpress/shared/schemas/inventory/create-movement.js';
import type { PageEnvelope } from '@mercadoexpress/shared/schemas/common/page.js';
import { sha256OfSortedJson } from '@/utils/idempotency-hash';

export type { Movement, CreateMovementRequest };

export interface ListMovementsOptions {
  page?: number;
  size?: number;
}

export async function listMovements(
  productId: string,
  opts: ListMovementsOptions = {},
): Promise<PageEnvelope<Movement>> {
  return http<PageEnvelope<Movement>>(`/products/${productId}/movements`, {
    query: {
      page: opts.page ?? 1,
      size: opts.size ?? 50,
    },
  });
}

export async function recordMovement(
  productId: string,
  input: CreateMovementRequest,
): Promise<Movement> {
  return http<Movement>(`/products/${productId}/movements`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

async function idempotencyHeader(body: unknown): Promise<HeadersInit> {
  const key = await sha256OfSortedJson(body);
  return { 'Idempotency-Key': key };
}

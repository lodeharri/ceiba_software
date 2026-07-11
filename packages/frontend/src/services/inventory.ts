/**
 * Inventory service — MercadoExpress SPA.
 *
 * Every response is validated against the shared Zod schemas so a
 * contract drift between backend and frontend (e.g. `stockAfter` field
 * missing) fails LOUDLY at the boundary instead of corrupting downstream
 * stores with a poisoned movement object.
 *
 * Mirrors the `auth.ts` Zod safeParse pattern.
 */
import { http } from './http';
import {
  movementSchema,
  pageEnvelopeSchema,
  type Movement,
  type CreateMovementRequest,
  type PageEnvelope,
} from '@mercadoexpress/shared';
import { sha256OfSortedJson } from '@/utils/idempotency-hash';

export type { Movement, CreateMovementRequest };

export interface ListMovementsOptions {
  page?: number;
  size?: number;
}

export class InvalidInventoryResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidInventoryResponseError';
  }
}

export async function listMovements(
  productId: string,
  opts: ListMovementsOptions = {},
): Promise<PageEnvelope<Movement>> {
  const raw = await http<unknown>(`/products/${productId}/movements`, {
    query: {
      page: opts.page ?? 1,
      size: opts.size ?? 50,
    },
  });

  const parsed = pageEnvelopeSchema(movementSchema).safeParse(raw);
  if (!parsed.success) {
    console.error('[inventory] listMovements response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidInventoryResponseError(
      'El servidor devolvió una lista de movimientos inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function recordMovement(
  productId: string,
  input: CreateMovementRequest,
): Promise<Movement> {
  const raw = await http<unknown>(`/products/${productId}/movements`, {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = movementSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[inventory] recordMovement response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidInventoryResponseError(
      'El servidor devolvió un movimiento registrado inválido.',
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

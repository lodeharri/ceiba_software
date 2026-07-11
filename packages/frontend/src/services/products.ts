/**
 * Products service — MercadoExpress SPA.
 *
 * Every response is validated against the shared Zod schemas so a
 * contract drift between backend and frontend (e.g. `price` casing)
 * fails LOUDLY at the boundary instead of corrupting downstream stores
 * with a poisoned product object.
 *
 * Mirrors the `auth.ts` Zod safeParse pattern.
 */
import { http } from './http';
import {
  productSchema,
  pageEnvelopeSchema,
  type Product,
  type CreateProductRequest,
  type UpdateProductRequest,
  type PageEnvelope,
} from '@mercadoexpress/shared';
import { sha256OfSortedJson } from '@/utils/idempotency-hash';

export type { Product, CreateProductRequest, UpdateProductRequest };

export interface ProductFilters {
  categoryId?: string;
  supplier?: string;
  hasActiveAlert?: boolean;
  minStock?: number;
  maxStock?: number;
  page?: number;
  size?: number;
}

export class InvalidProductsResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidProductsResponseError';
  }
}

export async function listProducts(filters: ProductFilters = {}): Promise<PageEnvelope<Product>> {
  const raw = await http<unknown>('/products', {
    query: {
      ...filters,
      page: filters.page ?? 1,
      size: filters.size ?? 20,
    },
  });

  const parsed = pageEnvelopeSchema(productSchema).safeParse(raw);
  if (!parsed.success) {
    console.error('[products] listProducts response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidProductsResponseError(
      'El servidor devolvió una lista de productos inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function getProduct(id: string): Promise<Product> {
  const raw = await http<unknown>(`/products/${id}`);

  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[products] getProduct response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidProductsResponseError(
      'El servidor devolvió un producto inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function createProduct(input: CreateProductRequest): Promise<Product> {
  const raw = await http<unknown>('/products', {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[products] createProduct response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidProductsResponseError(
      'El servidor devolvió un producto creado inválido.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function updateProduct(id: string, input: UpdateProductRequest): Promise<Product> {
  const raw = await http<unknown>(`/products/${id}`, {
    method: 'PATCH',
    body: input,
    headers: await idempotencyHeader(input),
  });

  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[products] updateProduct response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidProductsResponseError(
      'El servidor devolvió un producto actualizado inválido.',
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

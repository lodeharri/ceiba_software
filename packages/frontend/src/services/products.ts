/**
 * Products service — MercadoExpress SPA.
 */
import { http } from './http';
import type { Product } from '@mercadoexpress/shared/schemas/products/product.js';
import type { CreateProductRequest } from '@mercadoexpress/shared/schemas/products/create-product.js';
import type { UpdateProductRequest } from '@mercadoexpress/shared/schemas/products/update-product.js';
import type { PageEnvelope } from '@mercadoexpress/shared/schemas/common/page.js';
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

export async function listProducts(filters: ProductFilters = {}): Promise<PageEnvelope<Product>> {
  return http<PageEnvelope<Product>>('/products', {
    query: {
      ...filters,
      page: filters.page ?? 1,
      size: filters.size ?? 20,
    },
  });
}

export async function getProduct(id: string): Promise<Product> {
  return http<Product>(`/products/${id}`);
}

export async function createProduct(input: CreateProductRequest): Promise<Product> {
  return http<Product>('/products', {
    method: 'POST',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

export async function updateProduct(id: string, input: UpdateProductRequest): Promise<Product> {
  return http<Product>(`/products/${id}`, {
    method: 'PATCH',
    body: input,
    headers: await idempotencyHeader(input),
  });
}

async function idempotencyHeader(body: unknown): Promise<HeadersInit> {
  const key = await sha256OfSortedJson(body);
  return { 'Idempotency-Key': key };
}

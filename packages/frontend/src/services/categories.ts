/**
 * Categories service — MercadoExpress SPA.
 *
 * Categories are read-only in the MVP (no create surface per
 * categories/spec.md). The backend returns a page envelope
 * (`{ items, page, size, total, hasMore }`); we validate the envelope
 * at the boundary and surface the items array to callers, preserving
 * the existing `Promise<Category[]>` contract used by
 * `@/stores/categories`.
 *
 * Mirrors the `auth.ts` Zod safeParse pattern.
 */
import { http } from './http';
import { categorySchema, pageEnvelopeSchema, type Category } from '@mercadoexpress/shared';

export type { Category };

export class InvalidCategoriesResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidCategoriesResponseError';
  }
}

export async function listCategories(): Promise<Category[]> {
  const raw = await http<unknown>('/categories');

  const parsed = pageEnvelopeSchema(categorySchema).safeParse(raw);
  if (!parsed.success) {
    console.error('[categories] listCategories response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidCategoriesResponseError(
      'El servidor devolvió una lista de categorías inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data.items;
}

export async function createCategory(name: string): Promise<Category> {
  const raw = await http<unknown>('/categories', {
    method: 'POST',
    body: { name },
  });

  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[categories] createCategory response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidCategoriesResponseError(
      'El servidor devolvió una categoría creada inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

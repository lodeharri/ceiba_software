/**
 * Categories service — MercadoExpress SPA.
 */
import { http } from './http';
import type { Category } from '@mercadoexpress/shared/schemas/categories/category.js';

export type { Category };

export async function listCategories(): Promise<Category[]> {
  return http<Category[]>('/categories');
}

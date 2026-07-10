/**
 * Products BC — ListProductsUseCase (PR 2a, products/spec.md).
 *
 * Pass-through to `ProductRepository.list`. The use case exists for
 * the architectural seam (the BC layer injects policy at the boundary
 * — e.g. default page/size, max size guard, hasActiveAlert swallow).
 */

import type {
  ProductRepository,
  ProductFilters,
  Page,
} from '../domain/ports/product-repository.js';
import { Product } from '../domain/product.js';

export interface ListProductsInput {
  filters?: ProductFilters;
  page?: number;
  size?: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class ListProductsUseCase {
  constructor(private readonly products: ProductRepository) {}

  async execute(input: ListProductsInput = {}): Promise<Page<Product>> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.size ?? DEFAULT_PAGE_SIZE)));
    const result = await this.products.list({ filters: input.filters, page, size });
    return {
      items: result.items.map((p) => Product.rehydrate(p)),
      page: result.page,
      size: result.size,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

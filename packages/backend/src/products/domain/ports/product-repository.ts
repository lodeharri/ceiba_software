/**
 * Products BC — ProductRepository port (PR 2a).
 *
 * Read + write seam between the application layer and the Prisma
 * adapter. The `list` signature carries the same filter names the
 * `GET /products` query string uses (products/spec.md "List with filters").
 */

import type { ProductProps } from '../product.js';
export type { ProductProps };

export interface ProductFilters {
  categoryId?: string;
  supplier?: string;
  /** Deferred to PR 2b (alerts BC). PR 2a ignores the flag. */
  hasActiveAlert?: boolean;
  minStock?: number;
  maxStock?: number;
}

export interface ListOptions {
  filters?: ProductFilters | undefined;
  page: number;
  size: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

export interface ProductRepository {
  findById(id: string): Promise<ProductProps | null>;
  findBySku(sku: string): Promise<ProductProps | null>;
  create(props: ProductProps): Promise<ProductProps>;
  update(
    id: string,
    partial: Partial<Omit<ProductProps, 'id' | 'sku' | 'stock' | 'createdAt'>>,
  ): Promise<ProductProps>;
  list(opts: ListOptions): Promise<Page<ProductProps>>;
}

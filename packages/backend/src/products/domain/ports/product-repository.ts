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
  /**
   * KL-13: when `true`, the list is narrowed to products that
   * currently have at least one `ACTIVA` alert. `false` or `undefined`
   * preserves the original (unfiltered) behaviour for backward compat.
   */
  hasActiveAlert?: boolean;
  minStock?: number;
  maxStock?: number;
}

export interface ListOptions {
  filters?: ProductFilters | undefined;
  page: number;
  size: number;
  /**
   * Narrows the result to the supplied product ids. Set by the
   * `hasActiveAlert=true` path of `ListProductsUseCase` via the
   * `AlertReadModelPort` cross-BC seam (KL-13). Empty array is treated
   * as no filter (matches Prisma `id: { in: [] }` which would normally
   * empty the result, so the use case only forwards a non-empty set).
   */
  productIds?: readonly string[] | undefined;
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

  // Semantic search: cosine similarity via pgvector HNSW index
  findByEmbedding(
    embedding: number[],
    opts: { limit: number; minSimilarity?: number },
  ): Promise<ProductProps[]>;

  // Background path: update embedding after async computation
  updateEmbedding(id: string, embedding: number[]): Promise<void>;
}

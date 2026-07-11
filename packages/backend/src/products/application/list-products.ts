/**
 * Products BC — ListProductsUseCase (PR 2a + KL-13, products/spec.md).
 *
 * Pass-through to `ProductRepository.list`. The use case exists for
 * the architectural seam (the BC layer injects policy at the boundary
 * — e.g. default page/size, max size guard, hasActiveAlert filtering
 * via the cross-BC AlertReadModelPort).
 *
 * The response shape is the `Product` read model defined in
 * `packages/shared/src/schemas/products/product.ts`, which requires
 * `hasActiveAlert` on EVERY item. To populate it without an N+1 query
 * we resolve the full set of product ids with an active alert in a
 * single round-trip and reuse it for:
 *   1. KL-13 narrow filter (`hasActiveAlert=true` → forward the ids
 *      to the repository so the underlying query returns only matching
 *      rows).
 *   2. Per-product read-model enrichment (each Product instance gets
 *      `hasActiveAlert = set.has(id)` via `withAlertFlag`).
 */

import type {
  ProductRepository,
  ProductFilters,
  Page,
} from '../domain/ports/product-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';
import { Product } from '../domain/product.js';

export interface ListProductsInput {
  filters?: ProductFilters;
  page?: number;
  size?: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class ListProductsUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly alertReadModel: AlertReadModelPort,
  ) {}

  async execute(input: ListProductsInput = {}): Promise<Page<Product>> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.size ?? DEFAULT_PAGE_SIZE)));

    // The wire contract requires `hasActiveAlert` on every Product in
    // the list response, so we ALWAYS resolve the active-alert set —
    // the same result is reused for the KL-13 narrow filter when set.
    const ids = await this.alertReadModel.findProductIdsWithActiveAlert();
    const activeIds = new Set<string>(ids);

    // KL-13: `hasActiveAlert=true` narrows to products with at least
    // one ACTIVA alert. `false` and `undefined` preserve the existing
    // behaviour (the spec treats `false` as a no-op for backward
    // compatibility). When `true`, the empty-set short-circuit is
    // intentional — see PrismaProductRepository.buildWhere (KL-13).
    const productIds = input.filters?.hasActiveAlert === true ? ids : undefined;

    const result = await this.products.list({
      filters: input.filters,
      page,
      size,
      productIds,
    });
    return {
      items: result.items.map((p) => Product.rehydrate(p).withAlertFlag(activeIds.has(p.id))),
      page: result.page,
      size: result.size,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

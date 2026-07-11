/**
 * Products BC — AlertReadModelPort (KL-13, products/spec.md "List with
 * filters" — cross-BC seam to the alerts BC).
 *
 * Read-only port that resolves the `hasActiveAlert` filter on
 * `GET /api/v1/products` and the per-product `hasActiveAlert` flag
 * on the `Product` read model (products/spec.md "Read model") without
 * making the products BC depend on the alerts BC's domain or
 * application layers (RISK-W06).
 *
 * The concrete adapter lives in `products/infrastructure/` and queries
 * the `alerts` table directly via Prisma — there is NO Prisma relation
 * between products and alerts (design.md §4 forbids cross-BC FKs), so
 * the adapter reads `productId` as an opaque value column.
 */

export interface AlertReadModelPort {
  /**
   * Returns the deduplicated set of product ids that currently have at
   * least one active (`status = 'ACTIVA'`) alert. The result is
   * deduplicated server-side.
   */
  findProductIdsWithActiveAlert(): Promise<readonly string[]>;

  /**
   * Returns `true` iff the given product currently has at least one
   * active (`status = 'ACTIVA'`) alert. Used by `GetProductUseCase`
   * and `UpdateProductUseCase` to populate the read-model flag for
   * single-product responses.
   */
  hasActiveAlert(productId: string): Promise<boolean>;
}

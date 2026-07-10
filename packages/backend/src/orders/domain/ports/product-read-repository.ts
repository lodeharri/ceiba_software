/**
 * Orders BC — ProductReadRepository port (PR 2c, orders/spec.md).
 *
 * Read-only access to Product for the Orders BC. Used at create-time
 * to:
 *   (a) validate the product exists
 *   (b) snapshot Product.supplier (Q-P3)
 *   (c) validate quantity >= 2 * stockMin (BR-2)
 *
 * Consumed by:
 *   - `orders/application/create-order.ts`
 *
 * Implementation: `orders/infrastructure/prisma-product-read-repository.ts`.
 */

export interface ProductReadModel {
  id: string;
  sku: string;
  name: string;
  supplier: string;
  stockMin: number;
}

export interface ProductReadRepository {
  findById(id: string): Promise<ProductReadModel | null>;
}

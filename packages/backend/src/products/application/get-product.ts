/**
 * Products BC — GetProductUseCase (PR 2a).
 *
 * Enriches the read model with `hasActiveAlert` via the cross-BC
 * `AlertReadModelPort` (KL-13). The flag is attached to the returned
 * Product via `withAlertFlag(...)` so the handler can emit the wire
 * format required by `packages/shared/src/schemas/products/product.ts`
 * without polluting the domain entity.
 */

import { Product } from '../domain/product.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';

export class GetProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly alertReadModel: AlertReadModelPort,
  ) {}

  async execute(id: string): Promise<Product> {
    const found = await this.products.findById(id);
    if (!found) {
      throw new ProductNotFoundError(id);
    }
    const product = Product.rehydrate(found);
    const hasActiveAlert = await this.alertReadModel.hasActiveAlert(id);
    return product.withAlertFlag(hasActiveAlert);
  }
}

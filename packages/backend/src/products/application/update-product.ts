/**
 * Products BC — UpdateProductUseCase (PR 2a, products/spec.md "Update product").
 *
 * The patch accepts only `{ name, supplier, price, stockMin, categoryId }`.
 * Any attempt to PATCH `sku`, `stock`, or `id` is rejected at the
 * repository boundary (adapter enforces — RISK-S02 PATCH-with-same-body).
 *
 * The response carries `hasActiveAlert` (cross-BC flag, KL-13). PATCH
 * itself does not create or resolve alerts (alerts/spec.md), so the
 * post-update flag equals the pre-update flag.
 */

import { Product } from '../domain/product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';
import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { Logger as PinoLogger } from 'pino';
import { embedInBackground } from './embed-in-background.js';

export interface UpdateProductInput {
  name?: string;
  supplier?: string;
  description?: string | null;
  price?: number;
  stockMin?: number;
  categoryId?: string;
}

export class UpdateProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryReadRepository,
    private readonly alertReadModel: AlertReadModelPort,
    private readonly embedder?: EmbeddingPort,
    private readonly logger?: PinoLogger,
  ) {}

  async execute(id: string, input: UpdateProductInput): Promise<Product> {
    const existing = await this.products.findById(id);
    if (!existing) {
      throw new ProductNotFoundError(id);
    }
    if (input.categoryId) {
      const c = await this.categories.findById(input.categoryId);
      if (!c) throw new CategoryNotFoundError(input.categoryId);
    }
    const updated = await this.products.update(id, input);
    const product = Product.rehydrate(updated);
    const hasActiveAlert = await this.alertReadModel.hasActiveAlert(id);

    // Requirement 8: re-embed ONLY when text fields (name, description, supplier) change.
    // Detect by presence (field !== undefined), not by value change.
    const shouldReembed =
      input.name !== undefined || input.description !== undefined || input.supplier !== undefined;
    if (shouldReembed && this.embedder) {
      const log =
        this.logger ??
        ({
          warn: (_meta: object, _msg: string) => {
            /* no-op when no logger injected */
          },
        } as PinoLogger);
      setImmediate(() => embedInBackground(product, this.embedder!, this.products, log));
    }

    return product.withAlertFlag(hasActiveAlert);
  }
}

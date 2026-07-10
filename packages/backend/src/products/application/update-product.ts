/**
 * Products BC — UpdateProductUseCase (PR 2a, products/spec.md "Update product").
 *
 * The patch accepts only `{ name, supplier, price, stockMin, categoryId }`.
 * Any attempt to PATCH `sku`, `stock`, or `id` is rejected at the
 * repository boundary (adapter enforces — RISK-S02 PATCH-with-same-body).
 */

import { Product } from '../domain/product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';

export interface UpdateProductInput {
  name?: string;
  supplier?: string;
  price?: number;
  stockMin?: number;
  categoryId?: string;
}

export class UpdateProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryReadRepository,
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
    return Product.rehydrate(updated);
  }
}

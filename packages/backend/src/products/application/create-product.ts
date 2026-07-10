/**
 * Products BC — CreateProductUseCase (PR 2a).
 *
 * Sequence (products/spec.md "Create product with full validation"):
 *   1. Build a `Product.create(input)` aggregate — the static factory
 *      validates name / sku / price / stock / stockMin / supplier.
 *   2. Validate `categoryId` refers to an existing row.
 *   3. Check SKU uniqueness via `findBySku`. If present, throw
 *      `SkuAlreadyExistsError`.
 *   4. Persist via `ProductRepository.create`.
 */

import { randomUUID } from 'node:crypto';
import { Product } from '../domain/product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { SkuAlreadyExistsError } from '../domain/errors/sku-already-exists.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';

export interface CreateProductInput {
  sku: string;
  name: string;
  categoryId: string;
  price: number;
  stock: number;
  stockMin: number;
  supplier: string;
}

export class CreateProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryReadRepository,
  ) {}

  async execute(input: CreateProductInput): Promise<Product> {
    const aggregate = Product.create({
      id: randomUUID(),
      sku: input.sku,
      name: input.name,
      categoryId: input.categoryId,
      price: input.price,
      stock: input.stock,
      stockMin: input.stockMin,
      supplier: input.supplier,
    });

    const category = await this.categories.findById(aggregate.categoryId);
    if (!category) {
      throw new CategoryNotFoundError(aggregate.categoryId);
    }

    const existing = await this.products.findBySku(aggregate.sku);
    if (existing) {
      throw new SkuAlreadyExistsError(aggregate.sku, existing.id);
    }

    const persisted = await this.products.create({
      id: aggregate.id,
      sku: aggregate.sku,
      name: aggregate.name,
      categoryId: aggregate.categoryId,
      price: aggregate.price,
      stock: aggregate.stock,
      stockMin: aggregate.stockMin,
      supplier: aggregate.supplier,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return Product.rehydrate(persisted);
  }
}

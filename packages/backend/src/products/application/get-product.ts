/**
 * Products BC — GetProductUseCase (PR 2a).
 */

import { Product } from '../domain/product.js';
import { ProductNotFoundError } from '../domain/errors/product-not-found.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';

export class GetProductUseCase {
  constructor(private readonly products: ProductRepository) {}

  async execute(id: string): Promise<Product> {
    const found = await this.products.findById(id);
    if (!found) {
      throw new ProductNotFoundError(id);
    }
    return Product.rehydrate(found);
  }
}

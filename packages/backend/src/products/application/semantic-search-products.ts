/**
 * SemanticSearchUseCase (Group 10, R9).
 *
 * Validates the query, embeds it via the injected EmbeddingPort, then
 * performs a cosine-similarity search via the ProductRepository.
 */

import type { EmbeddingPort } from '../domain/ports/embedding.js';
import type { ProductRepository } from '../domain/ports/product-repository.js';
import { Product } from '../domain/product.js';
import { InvalidSemanticSearchQueryError } from '../domain/errors/invalid-semantic-search-query.js';

export interface SemanticSearchInput {
  query: string;
  limit: number;
}

export interface SemanticSearchResult {
  items: Product[];
  total: number;
}

export class SemanticSearchUseCase {
  constructor(
    private readonly embedder: EmbeddingPort,
    private readonly productRepo: ProductRepository,
  ) {}

  async execute(input: SemanticSearchInput): Promise<SemanticSearchResult> {
    if (input.query.length < 3 || input.query.length > 1024) {
      throw new InvalidSemanticSearchQueryError(input.query);
    }

    const vector = await this.embedder.embed(input.query);
    const results = await this.productRepo.findByEmbedding([...vector], { limit: input.limit });

    return {
      items: results.map((r) => Product.rehydrate(r)),
      total: results.length,
    };
  }
}

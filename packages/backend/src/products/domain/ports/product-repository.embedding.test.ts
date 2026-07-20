/**
 * RED fixture: assert ProductRepository interface includes embedding methods.
 * GREEN: add findByEmbedding + updateEmbedding to the interface.
 * TRIANGULATE: update all existing test stubs with the new methods.
 */

import { describe, it, expect } from 'vitest';
import type { ProductRepository } from './product-repository.js';

describe('ProductRepository — embedding methods', () => {
  it('interface includes findByEmbedding', () => {
    // Manual stub implementing the interface
    const repo: ProductRepository = {
      async findById(_id) {
        return null;
      },
      async findBySku(_sku) {
        return null;
      },
      async create(_props) {
        throw new Error('not used');
      },
      async update(_id, _partial) {
        throw new Error('not used');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async findByEmbedding(embedding, opts) {
        void embedding;
        void opts;
        return [];
      },
    };

    // Type-check: repo must have findByEmbedding
    expect(typeof repo.findByEmbedding).toBe('function');
  });

  it('interface includes updateEmbedding', () => {
    const repo: ProductRepository = {
      async findById(_id) {
        return null;
      },
      async findBySku(_sku) {
        return null;
      },
      async create(_props) {
        throw new Error('not used');
      },
      async update(_id, _partial) {
        throw new Error('not used');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async findByEmbedding(_embedding, _opts) {
        return [];
      },
      async updateEmbedding(id, embedding) {
        void id;
        void embedding;
      },
    };

    expect(typeof repo.updateEmbedding).toBe('function');
  });

  it('findByEmbedding signature matches design: (number[], opts) => Promise<ProductProps[]>', async () => {
    const repo: ProductRepository = {
      async findById(_id) {
        return null;
      },
      async findBySku(_sku) {
        return null;
      },
      async create(_props) {
        throw new Error('not used');
      },
      async update(_id, _partial) {
        throw new Error('not used');
      },
      async list() {
        return { items: [], page: 1, size: 20, total: 0, hasMore: false };
      },
      async findByEmbedding(embedding, opts) {
        // embedding is number[], opts has limit and optional minSimilarity
        void embedding;
        void opts.limit;
        void opts.minSimilarity;
        return [];
      },
      async updateEmbedding(_id, _embedding) {},
    };

    const result = await repo.findByEmbedding(Array(768).fill(0.1), { limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

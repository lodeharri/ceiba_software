import { describe, expect, it } from 'vitest';
import { CreateProductUseCase } from './create-product.js';
import { CategoryNotFoundError } from '../domain/errors/category-not-found.js';
import { SkuAlreadyExistsError } from '../domain/errors/sku-already-exists.js';
import type { ProductRepository, ProductProps } from '../domain/ports/product-repository.js';
import type { CategoryReadRepository } from '../domain/ports/category-repository.js';
import type { AlertOpenerPort } from '../../alerts/domain/ports/alert-opener-port.js';

const CAT = '00000000-0000-4000-8000-000000000001';
const VALID_INPUT = {
  sku: 'BEB-001',
  name: 'Agua Mineral 500ml',
  categoryId: CAT,
  price: 1500,
  stock: 100,
  stockMin: 50,
  supplier: 'Distribuidora Andina',
};

function makeRepos(opts: { existing?: ProductProps; hasCategory?: boolean } = {}): {
  products: ProductRepository;
  categories: CategoryReadRepository;
  created: ProductProps[];
  alertOpener: AlertOpenerPort;
} {
  const created: ProductProps[] = [];
  const products: ProductRepository = {
    async findById(id) {
      void id;
      return null;
    },
    async findBySku(sku) {
      if (opts.existing?.sku === sku) return opts.existing;
      return null;
    },
    async create(props) {
      created.push(props);
      return { ...props };
    },
    async update(id, partial) {
      void id;
      void partial;
      throw new Error('not used');
    },
    async list() {
      return { items: [], page: 1, size: 20, total: 0, hasMore: false };
    },
    async findByEmbedding(_embedding, _opts) {
      return [];
    },
    async updateEmbedding(_id, _embedding) {},
  };
  const categories: CategoryReadRepository = {
    async findById(id) {
      if (opts.hasCategory === false && id === CAT) return null;
      return { id, name: 'Bebidas' };
    },
    async list() {
      return [{ id: CAT, name: 'Bebidas' }];
    },
  };
  const alertOpener: AlertOpenerPort = {
    async openIfAbsent(_productId) {
      // no-op stub — tests use stock=100, stockMin=50 so this is never called
    },
  };
  return { products, categories, created, alertOpener };
}

describe('CreateProductUseCase', () => {
  it('happy path: validates, checks FK + SKU, and persists', async () => {
    const { products, categories, created, alertOpener } = makeRepos();
    const useCase = new CreateProductUseCase(products, categories, alertOpener);
    const product = await useCase.execute(VALID_INPUT);
    expect(product.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(product.sku).toBe('BEB-001'); // upper-cased by aggregate
    expect(product.price).toBe(1500);
    expect(created).toHaveLength(1);
  });

  it('throws SkuAlreadyExistsError on duplicate SKU', async () => {
    const { products, categories, alertOpener } = makeRepos({
      existing: { ...VALID_INPUT, id: 'existing-id' },
    });
    const useCase = new CreateProductUseCase(products, categories, alertOpener);
    await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(SkuAlreadyExistsError);
  });

  it('throws CategoryNotFoundError when categoryId is unknown', async () => {
    const { products, categories, alertOpener } = makeRepos({ hasCategory: false });
    const useCase = new CreateProductUseCase(products, categories, alertOpener);
    await expect(useCase.execute(VALID_INPUT)).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('does not throw when alert opener fails (best-effort graceful degradation)', async () => {
    const { products, categories, created } = makeRepos();
    const alertOpener: AlertOpenerPort = {
      async openIfAbsent(_productId: string) {
        throw new Error('Prisma connection lost');
      },
    };
    const useCase = new CreateProductUseCase(products, categories, alertOpener);
    const lowStockInput = { ...VALID_INPUT, stock: 0, stockMin: 10 };
    await expect(useCase.execute(lowStockInput)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
  });
});

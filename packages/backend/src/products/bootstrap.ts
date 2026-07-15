/**
 * Products BC bootstrap (PR 1.2).
 *
 * Wires all adapters into the application layer:
 *   - DrizzleProductRepository       (findById/findBySku/create/update/list)
 *   - DrizzleCategoryReadRepository  (findById/list for FK validation + filter)
 *   - CreateProductUseCase / ListProductsUseCase / GetProductUseCase / UpdateProductUseCase
 */

import { getDb, type Db } from '../shared/db.js';
import { CreateProductUseCase } from './application/create-product.js';
import { ListProductsUseCase } from './application/list-products.js';
import { GetProductUseCase } from './application/get-product.js';
import { UpdateProductUseCase } from './application/update-product.js';
import { DrizzleProductRepository } from './infrastructure/drizzle-product-repository.js';
import { DrizzleCategoryReadRepository } from './infrastructure/drizzle-category-read-repository.js';
import { DrizzleAlertReadModel } from './infrastructure/drizzle-alert-read-model.js';
import { DrizzleAlertOpenerPort } from '../alerts/infrastructure/drizzle-alert-opener-port.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface ProductsBootstrap {
  db: Db;
  logger: PinoLogger;
  createProduct: CreateProductUseCase;
  listProducts: ListProductsUseCase;
  getProduct: GetProductUseCase;
  updateProduct: UpdateProductUseCase;
  /** Categoría read repository is shared with the categories BC. */
  categoryReadRepository: DrizzleCategoryReadRepository;
}

interface GlobalWithProducts {
  __mercadoExpressProducts?: ProductsBootstrap;
}

export function bootstrapProducts(dbOverride?: Db): ProductsBootstrap {
  const g = globalThis as GlobalWithProducts;
  if (g.__mercadoExpressProducts) {
    return g.__mercadoExpressProducts;
  }
  const db = dbOverride ?? getDb();
  const productRepo = new DrizzleProductRepository(db);
  const categoryRead = new DrizzleCategoryReadRepository(db);
  const alertReadModel = new DrizzleAlertReadModel(db);
  const alertOpener = new DrizzleAlertOpenerPort(db);
  const bootstrap: ProductsBootstrap = {
    db,
    logger: createLogger().child({ bc: 'products' }),
    createProduct: new CreateProductUseCase(productRepo, categoryRead, alertOpener),
    listProducts: new ListProductsUseCase(productRepo, alertReadModel),
    getProduct: new GetProductUseCase(productRepo, alertReadModel),
    updateProduct: new UpdateProductUseCase(productRepo, categoryRead, alertReadModel),
    categoryReadRepository: categoryRead,
  };
  g.__mercadoExpressProducts = bootstrap;
  return bootstrap;
}

export function getProductsBootstrap(): ProductsBootstrap {
  return bootstrapProducts();
}

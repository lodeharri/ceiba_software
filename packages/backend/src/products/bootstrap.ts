/**
 * Products BC bootstrap (PR 2a).
 *
 * Wires all adapters into the application layer:
 *   - PrismaProductRepository        (findById/findBySku/create/update/list)
 *   - PrismaCategoryReadRepository   (findById/list for FK validation + filter)
 *   - CreateProductUseCase / ListProductsUseCase / GetProductUseCase / UpdateProductUseCase
 */

import { getPrismaClient, type PrismaLike } from '../shared/prisma-client.js';
import { CreateProductUseCase } from './application/create-product.js';
import { ListProductsUseCase } from './application/list-products.js';
import { GetProductUseCase } from './application/get-product.js';
import { UpdateProductUseCase } from './application/update-product.js';
import { PrismaProductRepository } from './infrastructure/prisma-product-repository.js';
import { PrismaCategoryReadRepository } from './infrastructure/prisma-category-read-repository.js';
import { PrismaAlertReadModel } from './infrastructure/prisma-alert-read-model.js';
import { PrismaAlertOpenerPort } from '../alerts/infrastructure/prisma-alert-opener-port.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface ProductsBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
  createProduct: CreateProductUseCase;
  listProducts: ListProductsUseCase;
  getProduct: GetProductUseCase;
  updateProduct: UpdateProductUseCase;
  /** Categoría read repository is shared with the categories BC. */
  categoryReadRepository: PrismaCategoryReadRepository;
}

interface GlobalWithProducts {
  __mercadoExpressProducts?: ProductsBootstrap;
}

export function bootstrapProducts(prismaOverride?: PrismaLike): ProductsBootstrap {
  const g = globalThis as GlobalWithProducts;
  if (g.__mercadoExpressProducts) {
    return g.__mercadoExpressProducts;
  }
  const prisma = (prismaOverride ?? getPrismaClient()) as unknown as ConstructorParameters<
    typeof PrismaProductRepository
  >[0] &
    ConstructorParameters<typeof PrismaCategoryReadRepository>[0] &
    ConstructorParameters<typeof PrismaAlertReadModel>[0] &
    PrismaLike;
  const productRepo = new PrismaProductRepository(prisma);
  const categoryRead = new PrismaCategoryReadRepository(prisma);
  const alertReadModel = new PrismaAlertReadModel(prisma);
  const alertOpener = new PrismaAlertOpenerPort(prisma);
  const bootstrap: ProductsBootstrap = {
    prisma: prismaOverride ?? getPrismaClient(),
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

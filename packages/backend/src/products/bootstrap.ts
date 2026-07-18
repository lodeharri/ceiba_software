/**
 * Products BC bootstrap (PR 1.2).
 *
 * Wires all adapters into the application layer:
 *   - DrizzleProductRepository       (findById/findBySku/create/update/list)
 *   - DrizzleCategoryReadRepository  (findById/list for FK validation + filter)
 *   - CreateProductUseCase / ListProductsUseCase / GetProductUseCase / UpdateProductUseCase
 *
 * Group 12: EmbeddingPort wiring — resolves API key, builds the embedder,
 * and injects it into CreateProductUseCase, UpdateProductUseCase, and
 * SemanticSearchUseCase. Cold-start only — warm invocations reuse the
 * singleton via globalThis.__mercadoExpressProducts.
 */

import { getDb, type Db } from '../shared/db.js';
import { CreateProductUseCase } from './application/create-product.js';
import { ListProductsUseCase } from './application/list-products.js';
import { GetProductUseCase } from './application/get-product.js';
import { UpdateProductUseCase } from './application/update-product.js';
import { SemanticSearchUseCase } from './application/semantic-search-products.js';
import { DrizzleProductRepository } from './infrastructure/drizzle-product-repository.js';
import { DrizzleCategoryReadRepository } from './infrastructure/drizzle-category-read-repository.js';
import { DrizzleAlertReadModel } from './infrastructure/drizzle-alert-read-model.js';
import { DrizzleAlertOpenerPort } from '../alerts/infrastructure/drizzle-alert-opener-port.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import type { EmbeddingPort } from './domain/ports/embedding.js';
import { resolveGeminiApiKey } from './infrastructure/embedding/api-key-resolver.js';
import { buildEmbeddingProvider } from './infrastructure/embedding/factory.js';

export interface ProductsBootstrap {
  db: Db;
  logger: PinoLogger;
  createProduct: CreateProductUseCase;
  listProducts: ListProductsUseCase;
  getProduct: GetProductUseCase;
  updateProduct: UpdateProductUseCase;
  /** Semantic search use case — uses the embedder injected at bootstrap time. */
  semanticSearch: SemanticSearchUseCase;
  /** Embedding port used by create/update/semantic search. */
  embeddingPort: EmbeddingPort;
  /** Categoría read repository is shared with the categories BC. */
  categoryReadRepository: DrizzleCategoryReadRepository;
}

interface GlobalWithProducts {
  __mercadoExpressProducts?: ProductsBootstrap;
}

export async function bootstrapProducts(dbOverride?: Db): Promise<ProductsBootstrap> {
  const g = globalThis as GlobalWithProducts;
  if (g.__mercadoExpressProducts) {
    return g.__mercadoExpressProducts;
  }

  const db = dbOverride ?? getDb();
  const productRepo = new DrizzleProductRepository(db);
  const categoryRead = new DrizzleCategoryReadRepository(db);
  const alertReadModel = new DrizzleAlertReadModel(db);
  const alertOpener = new DrizzleAlertOpenerPort(db);
  const logger = createLogger().child({ bc: 'products' });

  // Group 12: wire EmbeddingPort (cold-start only)
  const apiKey = await resolveGeminiApiKey(logger);
  const provider = process.env['EMBEDDING_PROVIDER'] ?? 'gemini';
  const embeddingPort = buildEmbeddingProvider({ provider, apiKey, logger });

  const bootstrap: ProductsBootstrap = {
    db,
    logger,
    createProduct: new CreateProductUseCase(
      productRepo,
      categoryRead,
      alertOpener,
      embeddingPort,
      logger,
    ),
    listProducts: new ListProductsUseCase(productRepo, alertReadModel),
    getProduct: new GetProductUseCase(productRepo, alertReadModel),
    updateProduct: new UpdateProductUseCase(
      productRepo,
      categoryRead,
      alertReadModel,
      embeddingPort,
    ),
    semanticSearch: new SemanticSearchUseCase(embeddingPort, productRepo),
    embeddingPort,
    categoryReadRepository: categoryRead,
  };

  g.__mercadoExpressProducts = bootstrap;
  return bootstrap;
}

export async function getProductsBootstrap(): Promise<ProductsBootstrap> {
  return bootstrapProducts();
}

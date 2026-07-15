/**
 * Categories BC bootstrap (PR 1.2).
 *
 * Wires `DrizzleCategoryRepository` into the application layer.
 */

import { getDb, type Db } from '../shared/db.js';
import { CreateCategoryUseCase } from './application/create-category.js';
import { ListCategoriesUseCase } from './application/list-categories.js';
import { DrizzleCategoryRepository } from './infrastructure/drizzle-category-repository.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface CategoriesBootstrap {
  db: Db;
  logger: PinoLogger;
  listCategories: ListCategoriesUseCase;
  createCategory: CreateCategoryUseCase;
}

interface GlobalWithCategories {
  __mercadoExpressCategories?: CategoriesBootstrap;
}

export function bootstrapCategories(dbOverride?: Db): CategoriesBootstrap {
  const g = globalThis as GlobalWithCategories;
  if (g.__mercadoExpressCategories) {
    return g.__mercadoExpressCategories;
  }
  const db = dbOverride ?? getDb();
  const repo = new DrizzleCategoryRepository(db);
  const bootstrap: CategoriesBootstrap = {
    db,
    logger: createLogger().child({ bc: 'categories' }),
    listCategories: new ListCategoriesUseCase(repo),
    createCategory: new CreateCategoryUseCase(repo),
  };
  g.__mercadoExpressCategories = bootstrap;
  return bootstrap;
}

export function getCategoriesBootstrap(): CategoriesBootstrap {
  return bootstrapCategories();
}

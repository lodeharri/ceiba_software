/**
 * Categories BC bootstrap (PR 2a).
 *
 * Wires `PrismaCategoryRepository` into the application layer.
 */

import { getPrismaClient, type PrismaLike } from '../shared/prisma-client.js';
import { CreateCategoryUseCase } from './application/create-category.js';
import { ListCategoriesUseCase } from './application/list-categories.js';
import { PrismaCategoryRepository } from './infrastructure/prisma-category-repository.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface CategoriesBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
  listCategories: ListCategoriesUseCase;
  createCategory: CreateCategoryUseCase;
}

interface GlobalWithCategories {
  __mercadoExpressCategories?: CategoriesBootstrap;
}

export function bootstrapCategories(prismaOverride?: PrismaLike): CategoriesBootstrap {
  const g = globalThis as GlobalWithCategories;
  if (g.__mercadoExpressCategories) {
    return g.__mercadoExpressCategories;
  }
  const prisma = (prismaOverride ?? getPrismaClient()) as unknown as ConstructorParameters<
    typeof PrismaCategoryRepository
  >[0];
  const repo = new PrismaCategoryRepository(prisma);
  const bootstrap: CategoriesBootstrap = {
    prisma: prismaOverride ?? getPrismaClient(),
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

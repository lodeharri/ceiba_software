/**
 * Products BC — PrismaCategoryReadRepository (PR 2a).
 *
 * Read-only adapter the products use cases depend on to validate the
 * `categoryId` FK. Implementation is a thin Prisma surface so the
 * adapter compiles without a generated client (the migrations Lambda
 * generates one at deploy time).
 */

import type {
  CategoryReadRepository,
  CategoryReadView,
} from '../domain/ports/category-repository.js';

interface CategoryPrisma {
  category: {
    findUnique(args: {
      where: { id?: string };
      select: { id: true; name: true };
    }): Promise<{ id: string; name: string } | null>;
    findMany(args: {
      select: { id: true; name: true };
      orderBy: { name: 'asc' };
    }): Promise<Array<{ id: string; name: string }>>;
  };
}

export class PrismaCategoryReadRepository implements CategoryReadRepository {
  constructor(private readonly prisma: CategoryPrisma) {}

  async findById(id: string): Promise<CategoryReadView | null> {
    const row = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    return row ?? null;
  }

  async list(): Promise<CategoryReadView[]> {
    return this.prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}

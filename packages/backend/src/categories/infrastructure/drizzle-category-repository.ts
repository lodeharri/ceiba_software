/**
 * Categories BC — DrizzleCategoryRepository (PR 1.2).
 *
 * Adapter implementing `CategoryRepository` against Drizzle ORM.
 * Replaces `PrismaCategoryRepository` for the Prisma → Drizzle migration.
 */

import { eq } from 'drizzle-orm';
import type { CategoryProps } from '../domain/category.js';
import type { CategoryRepository } from '../domain/ports/category-repository.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<CategoryProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByName(name: string): Promise<CategoryProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, name.trim()))
      .limit(1);
    return row ?? null;
  }

  async create(p: CategoryProps): Promise<CategoryProps> {
    const rows = await this.db
      .insert(schema.categories)
      .values({ id: p.id, name: p.name })
      .returning();
    return rows[0]!;
  }

  async list(): Promise<CategoryProps[]> {
    return this.db.select().from(schema.categories);
  }
}

/**
 * Products BC — DrizzleCategoryReadRepository (PR 1.2).
 *
 * Read-only adapter the products use cases depend on to validate the
 * `categoryId` FK. Implementation uses Drizzle ORM.
 */

import { eq } from 'drizzle-orm';
import type {
  CategoryReadRepository,
  CategoryReadView,
} from '../domain/ports/category-repository.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleCategoryReadRepository implements CategoryReadRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<CategoryReadView | null> {
    const [row] = await this.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(): Promise<CategoryReadView[]> {
    return this.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .orderBy(schema.categories.name);
  }
}

/**
 * Categories BC — ListCategoriesUseCase (PR 2a).
 *
 * Categories list (small reference dataset, no pagination needed for MVP).
 * Ordered by `name ASC` per categories/spec.md "Default list".
 */

import { Category } from '../domain/category.js';
import type { CategoryRepository } from '../domain/ports/category-repository.js';

export class ListCategoriesUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(): Promise<Category[]> {
    const rows = await this.categories.list();
    return rows
      .map((r) => Category.rehydrate(r))
      .sort((a, b) => a.name.localeCompare(b.name, 'es-CO'));
  }
}

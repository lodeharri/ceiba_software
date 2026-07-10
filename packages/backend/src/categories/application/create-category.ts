/**
 * Categories BC — CreateCategoryUseCase (PR 2a).
 */

import { randomUUID } from 'node:crypto';
import { Category } from '../domain/category.js';
import { CategoryAlreadyExistsError } from '../domain/errors/category-already-exists.js';
import type { CategoryRepository } from '../domain/ports/category-repository.js';

export interface CreateCategoryInput {
  name: string;
}

export class CreateCategoryUseCase {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(input: CreateCategoryInput): Promise<Category> {
    const aggregate = Category.create({ id: randomUUID(), name: input.name.trim() });
    const existing = await this.categories.findByName(aggregate.name);
    if (existing) {
      throw new CategoryAlreadyExistsError(aggregate.name, existing.id);
    }
    const created = await this.categories.create({
      id: aggregate.id,
      name: aggregate.name,
      createdAt: new Date(),
    });
    return Category.rehydrate(created);
  }
}

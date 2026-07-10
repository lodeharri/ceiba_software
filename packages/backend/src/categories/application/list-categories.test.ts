import { describe, expect, it } from 'vitest';
import { ListCategoriesUseCase } from './list-categories.js';
import type { CategoryRepository, CategoryProps } from '../domain/ports/category-repository.js';

const seed = (names: string[]): CategoryProps[] =>
  names.map((name, i) => ({ id: `id-${i}`, name, createdAt: new Date() }));

describe('ListCategoriesUseCase', () => {
  it('returns categories sorted by name ASC (es-CO)', async () => {
    const repo: CategoryRepository = {
      async findById() {
        return null;
      },
      async findByName() {
        return null;
      },
      async create(p) {
        return p;
      },
      async list() {
        return seed(['Snacks', 'Bebidas', 'Granos', 'Frutas', 'Lácteos', 'Limpieza']);
      },
    };
    const useCase = new ListCategoriesUseCase(repo);
    const result = await useCase.execute();
    expect(result.map((c) => c.name)).toEqual([
      'Bebidas',
      'Frutas',
      'Granos',
      'Lácteos',
      'Limpieza',
      'Snacks',
    ]);
  });
});

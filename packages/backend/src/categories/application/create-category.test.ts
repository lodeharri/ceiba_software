import { describe, expect, it } from 'vitest';
import { CreateCategoryUseCase } from './create-category.js';
import { CategoryAlreadyExistsError } from '../domain/errors/category-already-exists.js';
import type { CategoryRepository, CategoryProps } from '../domain/ports/category-repository.js';

function makeRepo(opts: { existing?: CategoryProps } = {}): {
  repo: CategoryRepository;
  created: CategoryProps[];
} {
  const created: CategoryProps[] = [];
  const repo: CategoryRepository = {
    async findById() {
      return null;
    },
    async findByName(name) {
      if (opts.existing?.name === name) return opts.existing;
      return null;
    },
    async create(p) {
      created.push(p);
      return p;
    },
    async list() {
      return [];
    },
  };
  return { repo, created };
}

describe('CreateCategoryUseCase', () => {
  it('happy path persists a new category', async () => {
    const { repo, created } = makeRepo();
    const useCase = new CreateCategoryUseCase(repo);
    const cat = await useCase.execute({ name: 'Congelados' });
    expect(cat.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(cat.name).toBe('Congelados');
    expect(created).toHaveLength(1);
  });

  it('throws CategoryAlreadyExistsError on duplicate name', async () => {
    const { repo } = makeRepo({
      existing: { id: 'existing-id', name: 'Congelados', createdAt: new Date() },
    });
    const useCase = new CreateCategoryUseCase(repo);
    await expect(useCase.execute({ name: 'Congelados' })).rejects.toBeInstanceOf(
      CategoryAlreadyExistsError,
    );
  });
});

/**
 * Categories BC — PrismaCategoryRepository (PR 2a).
 */

import type { CategoryProps } from '../domain/category.js';
import type { CategoryRepository } from '../domain/ports/category-repository.js';

interface PrismaCategoryRow {
  id: string;
  name: string;
  createdAt: Date;
}

interface CategoryPrisma {
  category: {
    findUnique(args: { where: { id?: string; name?: string } }): Promise<PrismaCategoryRow | null>;
    create(args: {
      data: { id: string; name: string; createdAt?: Date };
    }): Promise<PrismaCategoryRow>;
    findMany(): Promise<PrismaCategoryRow[]>;
  };
}

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: CategoryPrisma) {}

  async findById(id: string): Promise<CategoryProps | null> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    return row ? toProps(row) : null;
  }

  async findByName(name: string): Promise<CategoryProps | null> {
    const row = await this.prisma.category.findUnique({ where: { name: name.trim() } });
    return row ? toProps(row) : null;
  }

  async create(p: CategoryProps): Promise<CategoryProps> {
    const row = await this.prisma.category.create({ data: { id: p.id, name: p.name } });
    return toProps(row);
  }

  async list(): Promise<CategoryProps[]> {
    const rows = await this.prisma.category.findMany();
    return rows.map(toProps);
  }
}

function toProps(row: PrismaCategoryRow): CategoryProps {
  return { id: row.id, name: row.name, createdAt: row.createdAt };
}

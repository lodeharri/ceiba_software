/**
 * Products BC — CategoryRepository port (read-only, PR 2a).
 *
 * The products BC needs category lookups for two reasons:
 *   1. The create use case validates `categoryId` refers to an
 *      existing category (products/spec.md "Category does not exist").
 *   2. The list filter narrows the result set to one category.
 *
 * The interface lives in the products domain because the products BC
 * owns the FK relationship. The concrete implementation reuses the
 * categories BC's read-side adapter via the shared Prisma client.
 */

export interface CategoryReadView {
  id: string;
  name: string;
}

export interface CategoryReadRepository {
  findById(id: string): Promise<CategoryReadView | null>;
  list(): Promise<CategoryReadView[]>;
}

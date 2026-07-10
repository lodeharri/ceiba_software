/**
 * Categories BC — CategoryRepository port (PR 2a).
 */

import type { CategoryProps } from '../category.js';
export type { CategoryProps };

export interface CategoryRepository {
  findById(id: string): Promise<CategoryProps | null>;
  findByName(name: string): Promise<CategoryProps | null>;
  create(props: CategoryProps): Promise<CategoryProps>;
  list(): Promise<CategoryProps[]>;
}

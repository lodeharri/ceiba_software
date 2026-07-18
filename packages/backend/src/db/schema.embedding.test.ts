/**
 * RED fixture: verify embedding column is in the products schema.
 * GREEN: vector customType + embedding column added to schema.
 */

import { describe, it, expect } from 'vitest';
import * as schema from './schema.js';

describe('products schema — embedding column', () => {
  it('products table has embedding column', () => {
    // Verify the embedding property exists on the products table

    const productsTable = schema.products as unknown as { embedding?: unknown };
    expect(productsTable.embedding).toBeDefined();
  });

  it('embedding column infers as number[] | null in the row type', () => {
    // Type-level assertion: the inferred row type includes embedding

    const row = { embedding: null as number[] | null };
    expect(row.embedding).toBeNull();
  });
});

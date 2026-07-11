/**
 * Products BC — PrismaProductRepository buildWhere tests.
 *
 * Verifies the repository correctly translates ProductFilters into Prisma where clauses.
 * Strict TDD: RED (failing) → GREEN (implementation) → TRIANGULATE.
 *
 * The tests import `buildWhere` from the production module so a regression in
 * the real builder immediately fails the suite.
 */

import { describe, expect, it } from 'vitest';
import { buildWhere } from './prisma-product-repository.js';

describe('buildWhere', () => {
  it('returns empty object when no filters and no productIds', () => {
    expect(buildWhere()).toEqual({});
    expect(buildWhere(undefined)).toEqual({});
  });

  // ── categoryId ──────────────────────────────────────────────────────────────

  it('categoryId sets exact match (not contains)', () => {
    const cat = '00000000-0000-4000-8000-000000000001';
    const result = buildWhere({ categoryId: cat });
    expect(result.categoryId).toBe(cat);
  });

  it('categoryId does NOT use contains', () => {
    const cat = '00000000-0000-4000-8000-000000000001';
    const result = buildWhere({ categoryId: cat });
    // Must be exact string, not { contains: ... }
    expect(typeof result.categoryId).toBe('string');
    expect(result.categoryId).not.toEqual({ contains: cat });
  });

  // ── supplier ───────────────────────────────────────────────────────────────

  it('supplier sets contains match (case-sensitive)', () => {
    const result = buildWhere({ supplier: 'acme' });
    expect(result.supplier).toEqual({ contains: 'acme' });
  });

  it('supplier uses the actual supplier value (not lowercased)', () => {
    // The repository does NOT lowercase the supplier string.
    // PostgreSQL LIKE is case-sensitive by default.
    const result = buildWhere({ supplier: 'Distribuidora' });
    expect(result.supplier).toEqual({ contains: 'Distribuidora' });
  });

  // ── minStock / maxStock ─────────────────────────────────────────────────────

  it('minStock only sets stock.gte', () => {
    const result = buildWhere({ minStock: 5 });
    expect(result.stock).toEqual({ gte: 5 });
    expect(result.stock).not.toHaveProperty('lte');
  });

  it('maxStock only sets stock.lte', () => {
    const result = buildWhere({ maxStock: 50 });
    expect(result.stock).toEqual({ lte: 50 });
    expect(result.stock).not.toHaveProperty('gte');
  });

  it('minStock and maxStock together set both gte and lte', () => {
    const result = buildWhere({ minStock: 5, maxStock: 50 });
    expect(result.stock).toEqual({ gte: 5, lte: 50 });
  });

  it('minStock=0 and maxStock=0 are valid (edge case)', () => {
    const r1 = buildWhere({ minStock: 0 });
    expect(r1.stock).toEqual({ gte: 0 });
    const r2 = buildWhere({ maxStock: 0 });
    expect(r2.stock).toEqual({ lte: 0 });
    const r3 = buildWhere({ minStock: 0, maxStock: 0 });
    expect(r3.stock).toEqual({ gte: 0, lte: 0 });
  });

  // ── KL-13 productIds narrowing ─────────────────────────────────────────────

  it('productIds adds id.in without removing other filters', () => {
    const ids = ['id-1', 'id-2'];
    const cat = '00000000-0000-4000-8000-000000000001';
    const result = buildWhere({ categoryId: cat, minStock: 5 }, ids);
    expect(result.id).toEqual({ in: ids });
    expect(result.categoryId).toBe(cat);
    expect(result.stock).toEqual({ gte: 5 });
  });

  it('productIds empty array narrows to zero rows (no early return)', () => {
    const result = buildWhere({}, []);
    // Must NOT early-return {} — the KL-13 comment says an empty id.in=[]
    // correctly narrows to zero rows in Prisma.
    expect(result.id).toEqual({ in: [] });
  });

  it('productIds undefined leaves where unchanged (no id key)', () => {
    const result = buildWhere({ categoryId: 'cat-1' }, undefined);
    expect(result).not.toHaveProperty('id');
    expect(result.categoryId).toBe('cat-1');
  });

  // ── Combined filters ───────────────────────────────────────────────────────

  it('all filters together: categoryId + supplier + minStock + maxStock', () => {
    const result = buildWhere({
      categoryId: 'cat-1',
      supplier: 'acme',
      minStock: 5,
      maxStock: 50,
    });
    expect(result).toEqual({
      categoryId: 'cat-1',
      supplier: { contains: 'acme' },
      stock: { gte: 5, lte: 50 },
    });
  });
});

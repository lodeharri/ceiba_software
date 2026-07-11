/**
 * Products BC — list-products handler tests (bug: minStock/maxStock empty values).
 *
 * Strict TDD: RED (failing) → GREEN (implementation) → TRIANGULATE.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from './list-products.js';

describe('parseQuery — minStock/maxStock empty-value handling', () => {
  it('EMPTY: ?minStock= should be IGNORED (not accepted as 0)', () => {
    // Bug: Number('') === 0 passes Number.isInteger(0) && 0 >= 0
    // so the old code set minStock=0, which matches ALL products.
    // Expected: the key should not appear in the output.
    const result = parseQuery('minStock=');
    expect(result).not.toHaveProperty('minStock');
  });

  it('EMPTY: ?maxStock= should be IGNORED (not accepted as 0)', () => {
    const result = parseQuery('maxStock=');
    expect(result).not.toHaveProperty('maxStock');
  });

  it('EMPTY: ?minStock=&maxStock= should be IGNORED together', () => {
    const result = parseQuery('minStock=&maxStock=');
    expect(result).not.toHaveProperty('minStock');
    expect(result).not.toHaveProperty('maxStock');
  });

  it('UNDEFINED-LIKE: ?minStock=undefined should be IGNORED', () => {
    // The literal string "undefined" coerces to NaN, but we now silently
    // ignore it rather than throwing a validation error.
    const result = parseQuery('minStock=undefined');
    expect(result).not.toHaveProperty('minStock');
  });

  it('WHITESPACE: ?minStock=%20 (single space) should be IGNORED, not accepted as 0', () => {
    // Number(' ') is 0 — would silently accept minStock=0 and match every
    // product via where.stock.gte=0. Treat blank-like input as omitted.
    const result = parseQuery('minStock=%20');
    expect(result).not.toHaveProperty('minStock');
  });

  it('WHITESPACE: ?minStock=+ should THROW (single plus is not a valid integer)', () => {
    expect(() => parseQuery('minStock=%2B')).toThrow();
  });

  it('VALID: ?minStock=0 should be accepted as 0', () => {
    const result = parseQuery('minStock=0');
    expect(result.minStock).toBe(0);
  });

  it('VALID: ?maxStock=0 should be accepted as 0', () => {
    const result = parseQuery('maxStock=0');
    expect(result.maxStock).toBe(0);
  });

  it('VALID: ?minStock=5&maxStock=50 should filter correctly', () => {
    const result = parseQuery('minStock=5&maxStock=50');
    expect(result.minStock).toBe(5);
    expect(result.maxStock).toBe(50);
  });

  it('VALID: categoryId + supplier + minStock + maxStock together', () => {
    const cat = '00000000-0000-4000-8000-000000000001';
    const result = parseQuery(`categoryId=${cat}&supplier=acme&minStock=5&maxStock=50`);
    expect(result.categoryId).toBe(cat);
    expect(result.supplier).toBe('acme');
    expect(result.minStock).toBe(5);
    expect(result.maxStock).toBe(50);
  });

  it('hasActiveAlert=true is correctly coerced', () => {
    const result = parseQuery('hasActiveAlert=true');
    expect(result.hasActiveAlert).toBe(true);
  });

  it('hasActiveAlert=false is correctly coerced', () => {
    const result = parseQuery('hasActiveAlert=false');
    expect(result.hasActiveAlert).toBe(false);
  });

  it('hasActiveAlert=garbage throws', () => {
    expect(() => parseQuery('hasActiveAlert=garbage')).toThrow();
  });

  it('minStock=NaN throws', () => {
    expect(() => parseQuery('minStock=abc')).toThrow();
  });

  it('minStock=-1 throws', () => {
    expect(() => parseQuery('minStock=-1')).toThrow();
  });

  it('maxStock=-1 throws', () => {
    expect(() => parseQuery('maxStock=-1')).toThrow();
  });

  it('empty query string returns defaults only', () => {
    const result = parseQuery('');
    expect(result.page).toBe(1);
    expect(result.size).toBe(20);
    expect(result).not.toHaveProperty('categoryId');
    expect(result).not.toHaveProperty('supplier');
    expect(result).not.toHaveProperty('minStock');
    expect(result).not.toHaveProperty('maxStock');
  });
});

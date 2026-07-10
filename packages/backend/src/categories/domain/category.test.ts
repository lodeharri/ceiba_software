import { describe, expect, it } from 'vitest';
import { Category } from './category.js';

describe('Category.create', () => {
  it('creates a valid category', () => {
    const c = Category.create({ id: '11111111-1111-4111-8111-111111111111', name: 'Bebidas' });
    expect(c.name).toBe('Bebidas');
    expect(c.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects a too-short name', () => {
    expect(() =>
      Category.create({ id: '11111111-1111-4111-8111-111111111111', name: 'X' }),
    ).toThrow(/name/);
  });
});

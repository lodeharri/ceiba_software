/**
 * Unit tests for idempotency-hash utility (RISK-S07).
 *
 * Properties:
 *  - Same logical input → same SHA-256 hex hash (key-order independent).
 *  - Different input → different hash.
 *  - Hash is a 64-char lowercase hex string.
 */
import { describe, it, expect } from 'vitest';
import { sha256OfSortedJson } from './idempotency-hash';

describe('sha256OfSortedJson', () => {
  it('returns the same hash for two objects with the same content but different key order', async () => {
    const a = { foo: 'bar', count: 1, nested: { x: 1, y: 2 } };
    const b = { count: 1, nested: { y: 2, x: 1 }, foo: 'bar' };

    const hashA = await sha256OfSortedJson(a);
    const hashB = await sha256OfSortedJson(b);

    expect(hashA).toBe(hashB);
  });

  it('returns a different hash for a different input', async () => {
    const hashA = await sha256OfSortedJson({ foo: 'bar' });
    const hashB = await sha256OfSortedJson({ foo: 'baz' });

    expect(hashA).not.toBe(hashB);
  });

  it('produces a 64-char lowercase hex SHA-256 digest', async () => {
    const hash = await sha256OfSortedJson({ any: 'input', n: 42 });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toHaveLength(64);
  });
});

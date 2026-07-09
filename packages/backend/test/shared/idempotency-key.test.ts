/**
 * RED-first test for idempotency-key (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - Same body, same key → same hash (deterministic).
 *   - Same body, different key field ordering → same hash (key-sorted).
 *   - Different body → different hash.
 *
 * The persistence layer is PR 2a; PR 1 ships the interface + the hash function.
 */

import { describe, it, expect } from 'vitest';

describe('idempotency-key (sha256OfSortedJson)', () => {
  it('produces a deterministic hash for the same body and key', async () => {
    const { sha256OfSortedJson } = await import('../../src/shared/idempotency-key.js');

    const h1 = sha256OfSortedJson({ a: 1, b: 2 });
    const h2 = sha256OfSortedJson({ a: 1, b: 2 });

    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hash regardless of field ordering', async () => {
    const { sha256OfSortedJson } = await import('../../src/shared/idempotency-key.js');

    const h1 = sha256OfSortedJson({ a: 1, b: 2, c: 3 });
    const h2 = sha256OfSortedJson({ c: 3, a: 1, b: 2 });
    const h3 = sha256OfSortedJson({ b: 2, c: 3, a: 1 });

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('produces a different hash for a different body', async () => {
    const { sha256OfSortedJson } = await import('../../src/shared/idempotency-key.js');

    const h1 = sha256OfSortedJson({ a: 1 });
    const h2 = sha256OfSortedJson({ a: 2 });

    expect(h1).not.toBe(h2);
  });

  it('produces a different hash for a different value type', async () => {
    const { sha256OfSortedJson } = await import('../../src/shared/idempotency-key.js');

    const h1 = sha256OfSortedJson({ a: '1' });
    const h2 = sha256OfSortedJson({ a: 1 });

    expect(h1).not.toBe(h2);
  });
});

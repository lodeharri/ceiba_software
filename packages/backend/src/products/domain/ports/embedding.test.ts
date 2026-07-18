/**
 * RED fixture: assert EmbeddingPort interface exports correctly and stub behavior.
 * GREEN: implement the interface.
 * TRIANGULATE: order-preservation, dimension invariant.
 */

import { describe, it, expect } from 'vitest';
import type { EmbeddingPort } from './embedding.js';

describe('EmbeddingPort interface', () => {
  it('stub implements embed returning 768-dim readonly array', async () => {
    const stub: EmbeddingPort = {
      embed: async (_text: string) => Array(768).fill(0.1) as readonly number[],
    };

    const result = await stub.embed('laptop para gaming');
    expect(result).toHaveLength(768);
  });

  it('embedBatch returns parallel arrays in input order', async () => {
    const stub: EmbeddingPort = {
      embed: async (_text: string) => Array(768).fill(0.1) as readonly number[],
      embedBatch: async (texts: string[]) =>
        texts.map((_, i) => Array(768).fill(i * 0.1) as readonly number[]),
    };

    const results = await stub.embedBatch(['text one', 'text two']);
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(768);
    expect(results[1]).toHaveLength(768);
    // order preserved: different values
    expect(results[0]![0]).toBeCloseTo(0.0);
    expect(results[1]![0]).toBeCloseTo(0.1);
  });

  it('embed returns readonly number[] (defensive)', async () => {
    const stub: EmbeddingPort = {
      embed: async (_text: string) => Object.freeze(Array(768).fill(0.5)),
    };

    const result = await stub.embed('test');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(768);
    expect(result[0]).toBe(0.5);
  });
});

import { describe, expect, it } from 'vitest';
import type { AlertCloserPort } from './alert-closer-port.js';
import type { AlertRepository } from './alert-repository.js';

describe('AlertCloserPort (alerts BC — domain port)', () => {
  it('is a TypeScript interface with txCloseIfOpenAndAboveMin method', () => {
    // Structural check: a mock that satisfies the port compiles
    const stub: AlertCloserPort = {
      txCloseIfOpenAndAboveMin: async () => null,
    };
    expect(typeof stub.txCloseIfOpenAndAboveMin).toBe('function');
  });

  it('txCloseIfOpenAndAboveMin returns null when no active alert exists (idempotent)', async () => {
    const stub: AlertCloserPort = {
      txCloseIfOpenAndAboveMin: async () => null,
    };
    const result = await stub.txCloseIfOpenAndAboveMin({} as never, {
      productId: '11111111-1111-4111-8111-111111111111',
      newStock: 50,
      stockMin: 30,
    });
    expect(result).toBeNull();
  });

  it('txCloseIfOpenAndAboveMin returns closed alert id when alert exists', async () => {
    const stub: AlertCloserPort = {
      txCloseIfOpenAndAboveMin: async () => ({ alertId: 'alert-1' }),
    };
    const result = await stub.txCloseIfOpenAndAboveMin({} as never, {
      productId: '11111111-1111-4111-8111-111111111111',
      newStock: 50,
      stockMin: 30,
    });
    expect(result).toEqual({ alertId: 'alert-1' });
  });
});

describe('AlertRepository (alerts BC — domain port)', () => {
  it('is a TypeScript interface with findById, list, and count methods', () => {
    const stub: AlertRepository = {
      findById: async () => null,
      list: async () => ({ items: [], page: 1, size: 20, total: 0, hasMore: false }),
      count: async () => 0,
    };
    expect(typeof stub.findById).toBe('function');
    expect(typeof stub.list).toBe('function');
    expect(typeof stub.count).toBe('function');
  });
});

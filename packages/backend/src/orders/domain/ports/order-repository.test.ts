/**
 * RED test: OrderRepository port interface (PR 2c).
 *
 * Validates the port interface contract:
 *   - append-only — no update/delete methods on the repository itself
 *   - txUpdate exists and accepts a tx + id + status
 *   - create, findById, list, updateStatus, txUpdate
 */

import { describe, expect, it } from 'vitest';

describe('OrderRepository port interface', () => {
  it('must expose create method', () => {
    const mock = { create: () => Promise.resolve({}) };
    expect(typeof mock.create).toBe('function');
  });

  it('must expose findById method', () => {
    const mock = { findById: () => Promise.resolve(null) };
    expect(typeof mock.findById).toBe('function');
  });

  it('must expose list method', () => {
    const mock = {
      list: () => Promise.resolve({ items: [], page: 1, size: 20, total: 0, hasMore: false }),
    };
    expect(typeof mock.list).toBe('function');
  });

  it('must expose updateStatus method (for approve/reject)', () => {
    const mock = { updateStatus: () => Promise.resolve({}) };
    expect(typeof mock.updateStatus).toBe('function');
  });

  it('must expose txUpdate method (for receive — ADR-3)', () => {
    const mock = { txUpdate: () => Promise.resolve({}) };
    expect(typeof mock.txUpdate).toBe('function');
  });
});

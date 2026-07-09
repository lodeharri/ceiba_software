/**
 * RED-first schemas smoke test (PR 0, orchestrator-supplied special
 * consideration).
 *
 * For every primitive + per-BC schema the test asserts:
 *   - the happy-path input parses successfully and returns the expected
 *     shape;
 *   - the negative input is rejected with a typed ZodError (no silent
 *     coercion that masks a domain invariant).
 *
 * RED step: written alongside the schema stubs in commit 2.
 * GREEN step: the stubs already satisfy the positive cases; this test
 *   locks the contract so PR 2a use cases cannot regress the schemas.
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import {
  moneySchema,
  skuSchema,
  quantitySchema,
  movementTypeSchema,
  alertStatusSchema,
  orderStatusSchema,
  uuidSchema,
  emailSchema,
  usernameSchema,
  roleSchema,
  errorEnvelopeSchema,
  errorCodeSchema,
  pageEnvelopeSchema,
  idempotencyKeySchema,
  loginRequestSchema,
  loginResponseSchema,
  productSchema,
  createProductRequestSchema,
  updateProductRequestSchema,
  movementSchema,
  createMovementRequestSchema,
  alertSchema,
  orderSchema,
  createOrderRequestSchema,
  approveOrderRequestSchema,
  rejectOrderRequestSchema,
  receiveOrderRequestSchema,
  categorySchema,
  ErrorCode,
} from '../src/index.js';

describe('domain primitives — happy path', () => {
  it('moneySchema accepts a non-negative integer', () => {
    expect(moneySchema.parse(0)).toBe(0);
    expect(moneySchema.parse(1500)).toBe(1500);
    expect(moneySchema.parse(999_999_999_999)).toBe(999_999_999_999);
  });

  it('skuSchema accepts an alphanumeric string 6-20 chars', () => {
    expect(skuSchema.parse('BEB-001')).toBe('BEB-001');
    expect(skuSchema.parse('ABCdef123')).toBe('ABCdef123');
  });

  it('quantitySchema accepts a positive integer', () => {
    expect(quantitySchema.parse(1)).toBe(1);
    expect(quantitySchema.parse(999)).toBe(999);
  });

  it('movementTypeSchema is ENTRADA | SALIDA', () => {
    expect(movementTypeSchema.parse('ENTRADA')).toBe('ENTRADA');
    expect(movementTypeSchema.parse('SALIDA')).toBe('SALIDA');
  });

  it('alertStatusSchema is ACTIVA | RESUELTA', () => {
    expect(alertStatusSchema.parse('ACTIVA')).toBe('ACTIVA');
    expect(alertStatusSchema.parse('RESUELTA')).toBe('RESUELTA');
  });

  it('orderStatusSchema is PENDIENTE | APROBADA | RECHAZADA | RECIBIDA', () => {
    expect(orderStatusSchema.parse('PENDIENTE')).toBe('PENDIENTE');
    expect(orderStatusSchema.parse('RECIBIDA')).toBe('RECIBIDA');
  });

  it('uuidSchema accepts UUID v4 strings', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(uuidSchema.parse(id)).toBe(id);
  });

  it('emailSchema lower-cases valid emails', () => {
    expect(emailSchema.parse('USER@example.COM')).toBe('user@example.com');
  });

  it('usernameSchema lower-cases valid usernames', () => {
    expect(usernameSchema.parse('Admin')).toBe('admin');
    expect(usernameSchema.parse('jane_doe-2')).toBe('jane_doe-2');
  });

  it('roleSchema accepts the only role in MVP: admin', () => {
    expect(roleSchema.parse('admin')).toBe('admin');
  });
});

describe('domain primitives — rejection path', () => {
  it('moneySchema rejects negative and fractional values', () => {
    expect(() => moneySchema.parse(-1)).toThrow(ZodError);
    expect(() => moneySchema.parse(1.5)).toThrow(ZodError);
  });

  it('skuSchema rejects short, long, and non-alphanumeric strings', () => {
    expect(() => skuSchema.parse('ab')).toThrow(ZodError);
    expect(() => skuSchema.parse('a'.repeat(21))).toThrow(ZodError);
    expect(() => skuSchema.parse('sku with spaces')).toThrow(ZodError);
  });

  it('quantitySchema rejects zero and negative integers', () => {
    expect(() => quantitySchema.parse(0)).toThrow(ZodError);
    expect(() => quantitySchema.parse(-1)).toThrow(ZodError);
  });

  it('movementTypeSchema rejects any other string', () => {
    expect(() => movementTypeSchema.parse('AJUSTE')).toThrow(ZodError);
  });

  it('orderStatusSchema rejects undefined transitions', () => {
    expect(() => orderStatusSchema.parse('CANCELADA')).toThrow(ZodError);
  });

  it('uuidSchema rejects non-UUID strings', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow(ZodError);
  });

  it('emailSchema rejects strings without an @ and a dot', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow(ZodError);
  });

  it('usernameSchema rejects too-short usernames', () => {
    expect(() => usernameSchema.parse('ab')).toThrow(ZodError);
  });

  it('roleSchema rejects any role other than admin (MVP)', () => {
    expect(() => roleSchema.parse('viewer')).toThrow(ZodError);
  });
});

describe('common envelopes', () => {
  it('errorEnvelopeSchema accepts a valid envelope', () => {
    const envelope = errorEnvelopeSchema.parse({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid input.',
    });
    expect(envelope.code).toBe('VALIDATION_ERROR');
    expect(envelope.message).toBe('Invalid input.');
  });

  it('errorEnvelopeSchema rejects an unknown code', () => {
    expect(() => errorEnvelopeSchema.parse({ code: 'WHO_KNOWS', message: 'x' })).toThrow(ZodError);
  });

  it('errorCodeSchema covers every registry entry', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
  });

  it('pageEnvelopeSchema computes shape for a generic list', () => {
    const schema = pageEnvelopeSchema(productSchema.shape.sku);
    const parsed = schema.parse({
      items: ['BEB-001', 'BEB-002'],
      page: 1,
      size: 2,
      total: 6,
      hasMore: true,
    });
    expect(parsed.items).toEqual(['BEB-001', 'BEB-002']);
    expect(parsed.hasMore).toBe(true);
  });

  it('pageEnvelopeSchema rejects an out-of-range size', () => {
    const schema = pageEnvelopeSchema(productSchema.shape.sku);
    expect(() =>
      schema.parse({ items: [], page: 1, size: 9999, total: 0, hasMore: false }),
    ).toThrow(ZodError);
  });

  it('idempotencyKeySchema accepts a UUID v4', () => {
    expect(idempotencyKeySchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });
});

describe('auth schemas', () => {
  it('loginRequestSchema accepts username + password', () => {
    const req = loginRequestSchema.parse({ username: 'admin', password: 'x' });
    expect(req.username).toBe('admin');
  });

  it('loginResponseSchema carries token + expiresAt + user', () => {
    const res = loginResponseSchema.parse({
      token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
      expiresAt: '2026-01-01T00:00:00.000Z',
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        username: 'admin',
        role: 'admin',
      },
    });
    expect(res.user.role).toBe('admin');
  });
});

describe('product schemas', () => {
  it('productSchema accepts a valid product', () => {
    const p = productSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      sku: 'BEB-001',
      name: 'Agua Mineral 500ml',
      price: '3500',
      stock: 12,
      stockMin: 5,
      supplier: 'Coca-Cola',
      categoryId: '550e8400-e29b-41d4-a716-446655440001',
      hasActiveAlert: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(p.sku).toBe('BEB-001');
  });

  it('createProductRequestSchema accepts a valid create body', () => {
    const body = createProductRequestSchema.parse({
      sku: 'BEB-001',
      name: 'Agua Mineral 500ml',
      price: 3500,
      stockMin: 5,
      supplier: 'Coca-Cola',
      categoryId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(body.stockMin).toBe(5);
  });

  it('createProductRequestSchema rejects a too-short name', () => {
    expect(() =>
      createProductRequestSchema.parse({
        sku: 'BEB-001',
        name: 'ab',
        price: 3500,
        stockMin: 5,
        supplier: 'Coca-Cola',
        categoryId: '550e8400-e29b-41d4-a716-446655440001',
      }),
    ).toThrow(ZodError);
  });

  it('updateProductRequestSchema rejects forbidden fields (sku, stock, id)', () => {
    expect(() => updateProductRequestSchema.parse({ sku: 'X' })).toThrow(ZodError);
    expect(() => updateProductRequestSchema.parse({ stock: 100 })).toThrow(ZodError);
    expect(() =>
      updateProductRequestSchema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' }),
    ).toThrow(ZodError);
  });
});

describe('inventory schemas', () => {
  it('movementSchema accepts a valid movement', () => {
    const m = movementSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      productId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'ENTRADA',
      quantity: 10,
      reason: 'Restock from supplier.',
      userId: '550e8400-e29b-41d4-a716-446655440002',
      stockAfter: 22,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(m.stockAfter).toBe(22);
  });

  it('createMovementRequestSchema requires a non-empty reason', () => {
    expect(() =>
      createMovementRequestSchema.parse({
        type: 'ENTRADA',
        quantity: 5,
        reason: '',
      }),
    ).toThrow(ZodError);
  });
});

describe('alerts schemas', () => {
  it('alertSchema accepts a RESUELTA alert with resolvedAt', () => {
    const a = alertSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      productId: '550e8400-e29b-41d4-a716-446655440001',
      productName: 'Agua Mineral 500ml',
      productSku: 'BEB-001',
      stockAtOpen: 3,
      stockMin: 5,
      status: 'RESUELTA',
      resolvedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(a.resolvedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('orders schemas', () => {
  it('orderSchema accepts a PENDIENTE order with fromAlertId', () => {
    const o = orderSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      productId: '550e8400-e29b-41d4-a716-446655440001',
      productName: 'Agua Mineral 500ml',
      productSku: 'BEB-001',
      quantity: 20,
      supplierSnapshot: 'Coca-Cola',
      fromAlertId: '550e8400-e29b-41d4-a716-446655440002',
      status: 'PENDIENTE',
      rejectionReason: null,
      createdBy: '550e8400-e29b-41d4-a716-446655440003',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      receivedAt: null,
    });
    expect(o.status).toBe('PENDIENTE');
  });

  it('createOrderRequestSchema accepts an optional fromAlertId', () => {
    const req = createOrderRequestSchema.parse({
      productId: '550e8400-e29b-41d4-a716-446655440000',
      quantity: 20,
    });
    expect(req.fromAlertId).toBeUndefined();
  });

  it('approveOrderRequestSchema is strict — rejects unknown fields', () => {
    expect(() => approveOrderRequestSchema.parse({ reason: 'no' })).toThrow(ZodError);
  });

  it('rejectOrderRequestSchema requires a >= 10-char reason (BR-D2)', () => {
    expect(() => rejectOrderRequestSchema.parse({ reason: 'short' })).toThrow(ZodError);
    const ok = rejectOrderRequestSchema.parse({
      reason: 'Price out of policy.',
    });
    expect(ok.reason).toBe('Price out of policy.');
  });

  it('receiveOrderRequestSchema is strict — no payload', () => {
    expect(() => receiveOrderRequestSchema.parse({ foo: 'bar' })).toThrow(ZodError);
  });
});

describe('categories schema', () => {
  it('categorySchema accepts a valid category', () => {
    const c = categorySchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Bebidas',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(c.name).toBe('Bebidas');
  });

  it('categorySchema rejects an empty name', () => {
    expect(() =>
      categorySchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(ZodError);
  });
});

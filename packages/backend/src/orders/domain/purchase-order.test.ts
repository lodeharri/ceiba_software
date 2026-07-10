/**
 * RED test: Orders BC — PurchaseOrder aggregate (PR 2c).
 *
 * Validates the PurchaseOrder state machine and invariants:
 *   - status ∈ {PENDIENTE, APROBADA, RECHAZADA, RECIBIDA}
 *   - quantity must be a positive integer
 *   - supplierSnapshot is write-once (Q-P3)
 *   - rejectionReason.length >= 10 when status = RECHAZADA
 *   - fromAlertId is a valid UUID when set
 *   - State machine transitions (BR-5)
 *
 * Note: `create()` always sets status to PENDIENTE (BR-5 enforced).
 * Tests for non-PENDIENTE initial states use `rehydrate()`.
 */

import { describe, expect, it } from 'vitest';
import { PurchaseOrder } from './purchase-order.js';

const VALID_ID = '11111111-1111-1111-1111-111111111111';
const VALID_PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const VALID_USER_ID = '33333333-3333-3333-3333-333333333333';
const VALID_SUPPLIER = 'Distribuidora Andina';

function makeValid(
  input: Partial<{
    id: string;
    productId: string;
    quantity: number;
    supplierSnapshot: string;
    fromAlertId: string | null;
    reason: string | null;
    createdBy: string;
    status: string;
    receivedAt: Date | null;
  }> = {},
): {
  id: string;
  productId: string;
  quantity: number;
  supplierSnapshot: string;
  fromAlertId: string | null;
  reason: string | null;
  createdBy: string;
  status: string;
  receivedAt: Date | null;
} {
  return {
    id: VALID_ID,
    productId: VALID_PRODUCT_ID,
    quantity: 60,
    supplierSnapshot: VALID_SUPPLIER,
    fromAlertId: null,
    reason: null,
    createdBy: VALID_USER_ID,
    status: 'PENDIENTE',
    receivedAt: null as Date | null,
    ...input,
  };
}

/** Helper: create a new order (status = PENDIENTE) */
function createOrder(input?: Partial<ReturnType<typeof makeValid>>) {
  return PurchaseOrder.create(makeValid(input));
}

/** Helper: rehydrate an order with any status (bypasses create() state machine) */
function rehydrateOrder(
  status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA',
  receivedAt: Date | null = null,
) {
  return PurchaseOrder.rehydrate({
    id: VALID_ID,
    productId: VALID_PRODUCT_ID,
    quantity: 60,
    supplierSnapshot: VALID_SUPPLIER,
    fromAlertId: null,
    reason: null,
    createdBy: VALID_USER_ID,
    status,
    receivedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('PurchaseOrder — state machine (BR-5)', () => {
  it('PENDIENTE → APROBADA via approve()', () => {
    const order = createOrder();
    expect(order.status).toBe('PENDIENTE');
    const approved = order.approve();
    expect(approved.status).toBe('APROBADA');
    expect(approved.id).toBe(order.id);
  });

  it('PENDIENTE → RECHAZADA via reject(reason)', () => {
    const order = createOrder();
    const rejected = order.reject('Proveedor sin stock hasta el lunes.');
    expect(rejected.status).toBe('RECHAZADA');
    expect(rejected.reason).toBe('Proveedor sin stock hasta el lunes.');
  });

  it('APROBADA → RECIBIDA via receive()', () => {
    const order = rehydrateOrder('APROBADA');
    const received = order.receive();
    expect(received.status).toBe('RECIBIDA');
    expect(received.receivedAt).toBeTruthy();
  });

  it('PENDIENTE → RECIBIDA throws OrderInvalidTransitionError', () => {
    const order = createOrder();
    expect(() => order.receive()).toThrow('Cannot receive order in state PENDIENTE.');
  });

  it('APROBADA → APROBADA (re-approve) throws OrderInvalidTransitionError', () => {
    const order = rehydrateOrder('APROBADA');
    expect(() => order.approve()).toThrow('Cannot approve order in state APROBADA.');
  });

  it('RECHAZADA → any throws OrderInvalidTransitionError', () => {
    const order = rehydrateOrder('RECHAZADA');
    expect(() => order.approve()).toThrow('Cannot approve order in state RECHAZADA.');
    expect(() => order.reject('Proveedor sin stock.')).toThrow(
      'Cannot reject order in state RECHAZADA.',
    );
    expect(() => order.receive()).toThrow('Cannot receive order in state RECHAZADA.');
  });

  it('RECIBIDA → any throws OrderInvalidTransitionError', () => {
    const order = rehydrateOrder('RECIBIDA', new Date());
    expect(() => order.approve()).toThrow('Cannot approve order in state RECIBIDA.');
    expect(() => order.reject('Proveedor sin stock.')).toThrow(
      'Cannot reject order in state RECIBIDA.',
    );
    expect(() => order.receive()).toThrow('Cannot receive order in state RECIBIDA.');
  });
});

describe('PurchaseOrder — invariants', () => {
  it('quantity must be a positive integer', () => {
    expect(() => PurchaseOrder.create(makeValid({ quantity: 0 }))).toThrow(
      'quantity must be a positive integer',
    );
    expect(() => PurchaseOrder.create(makeValid({ quantity: -1 }))).toThrow(
      'quantity must be a positive integer',
    );
    expect(() => PurchaseOrder.create(makeValid({ quantity: 1.5 }))).toThrow(
      'quantity must be a positive integer',
    );
  });

  it('supplierSnapshot must be non-empty', () => {
    expect(() => PurchaseOrder.create(makeValid({ supplierSnapshot: '' }))).toThrow(
      'supplierSnapshot must be non-empty',
    );
    expect(() => PurchaseOrder.create(makeValid({ supplierSnapshot: '   ' }))).toThrow(
      'supplierSnapshot must be non-empty',
    );
  });

  it('supplierSnapshot is write-once (Q-P3): approve does NOT refresh it', () => {
    const order = createOrder({ supplierSnapshot: 'SnacksCorp' });
    const approved = order.approve();
    expect(approved.supplierSnapshot).toBe('SnacksCorp');
  });

  it('reject requires reason.length >= 10 (BR-D2)', () => {
    const order = createOrder();
    // Error message is in Spanish from RejectionReasonTooShortError
    expect(() => order.reject('no')).toThrow('al menos 10 caracteres');
    expect(() => order.reject('123456789')).toThrow('al menos 10 caracteres');
    expect(() => order.reject('1234567890')).not.toThrow();
  });

  it('rejected order carries reason', () => {
    const order = createOrder();
    const rejected = order.reject('Proveedor sin stock esta semana completo.');
    expect(rejected.reason).toBe('Proveedor sin stock esta semana completo.');
  });

  it('receivedAt is set iff status is RECIBIDA', () => {
    const order = createOrder();
    expect(order.receivedAt).toBeNull();

    const approved = order.approve();
    expect(approved.receivedAt).toBeNull();

    const received = approved.receive();
    expect(received.receivedAt).not.toBeNull();
  });

  it('rehydrate returns order with correct status', () => {
    const order = rehydrateOrder('APROBADA');
    expect(order.status).toBe('APROBADA');
    expect(order.supplierSnapshot).toBe(VALID_SUPPLIER);
  });
});

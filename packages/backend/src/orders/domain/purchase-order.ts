/**
 * Orders BC — PurchaseOrder aggregate (PR 2c, orders/spec.md + design.md §3).
 *
 * Pure domain entity — imports nothing from infrastructure.
 *
 * Invariants enforced at construction:
 *   - status ∈ {PENDIENTE, APROBADA, RECHAZADA, RECIBIDA}
 *   - transitions follow BR-5 (state machine below)
 *   - quantity >= 1
 *   - supplierSnapshot: non-empty, write-once (Q-P3)
 *   - rejectionReason: null when status ≠ RECHAZADA, length >= 10 when set (BR-D2)
 *   - fromAlertId: valid UUID when set, or null
 *   - receivedAt: set iff status = RECIBIDA
 *
 * State machine (BR-5):
 *   PENDIENTE → APROBADA  (via approve())
 *   PENDIENTE → RECHAZADA (via reject())
 *   APROBADA  → RECIBIDA  (via receive())
 *
 * All other transitions throw OrderInvalidTransitionError.
 */

import { OrderInvalidTransitionError } from './errors/order-invalid-transition.js';
import { RejectionReasonTooShortError } from './errors/rejection-reason-too-short.js';

const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type OrderStatusType = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'RECIBIDA';

export interface PurchaseOrderProps {
  id: string;
  productId: string;
  quantity: number;
  status: OrderStatusType;
  supplierSnapshot: string;
  fromAlertId: string | null;
  reason: string | null;
  createdBy: string;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PurchaseOrder {
  private constructor(public readonly props: PurchaseOrderProps) {}

  static create(input: {
    id: string;
    productId: string;
    quantity: number;
    supplierSnapshot: string;
    fromAlertId?: string | null;
    reason?: string | null;
    createdBy: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): PurchaseOrder {
    PurchaseOrder.assertInvariants({
      ...input,
      status: 'PENDIENTE',
      fromAlertId: input.fromAlertId ?? null,
      reason: null,
    });
    return new PurchaseOrder({
      ...input,
      status: 'PENDIENTE',
      fromAlertId: input.fromAlertId ?? null,
      reason: null,
      receivedAt: null,
      createdAt: input.createdAt ?? new Date(),
      updatedAt: input.updatedAt ?? new Date(),
    });
  }

  static rehydrate(props: PurchaseOrderProps): PurchaseOrder {
    return new PurchaseOrder(props);
  }

  static assertInvariants(p: {
    id: string;
    productId: string;
    quantity: number;
    status: OrderStatusType;
    supplierSnapshot: string;
    fromAlertId: string | null;
    reason: string | null;
    createdBy: string;
    receivedAt?: Date | null;
  }): void {
    if (!p.id || !UUID_V4_REGEX.test(p.id)) {
      throw new Error('PurchaseOrder.id must be a valid UUID');
    }
    if (!p.productId || !UUID_V4_REGEX.test(p.productId)) {
      throw new Error('PurchaseOrder.productId must be a valid UUID');
    }
    if (!Number.isInteger(p.quantity) || p.quantity < 1) {
      throw new Error('PurchaseOrder.quantity must be a positive integer');
    }
    const VALID_STATUSES: OrderStatusType[] = ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'RECIBIDA'];
    if (!VALID_STATUSES.includes(p.status)) {
      throw new Error(
        `PurchaseOrder.status must be one of ${VALID_STATUSES.join(', ')}, got '${p.status}'`,
      );
    }
    if (!p.supplierSnapshot || p.supplierSnapshot.trim().length === 0) {
      throw new Error('PurchaseOrder.supplierSnapshot must be non-empty');
    }
    if (p.supplierSnapshot.length > 120) {
      throw new Error('PurchaseOrder.supplierSnapshot must be at most 120 characters');
    }
    if (p.fromAlertId !== null && !UUID_V4_REGEX.test(p.fromAlertId)) {
      throw new Error('PurchaseOrder.fromAlertId must be a valid UUID or null');
    }
    // rejectionReason: null unless status is RECHAZADA
    if (p.status !== 'RECHAZADA' && p.reason !== null) {
      throw new Error('PurchaseOrder.reason must be null unless status is RECHAZADA');
    }
    if (p.status === 'RECHAZADA' && (p.reason === null || p.reason.length < 10)) {
      throw new Error(
        'PurchaseOrder.reason must be at least 10 characters when status is RECHAZADA',
      );
    }
    if (!p.createdBy || !UUID_V4_REGEX.test(p.createdBy)) {
      throw new Error('PurchaseOrder.createdBy must be a valid UUID');
    }
    // receivedAt: set iff status is RECIBIDA
    if (p.status === 'RECIBIDA' && p.receivedAt === null) {
      throw new Error('PurchaseOrder.receivedAt must be set when status is RECIBIDA');
    }
    if (p.status !== 'RECIBIDA' && p.receivedAt !== null) {
      throw new Error('PurchaseOrder.receivedAt must be null unless status is RECIBIDA');
    }
  }

  /** Approve: PENDIENTE → APROBADA. Throws on any other status. */
  approve(): PurchaseOrder {
    if (this.props.status !== 'PENDIENTE') {
      throw new OrderInvalidTransitionError(this.props.status, 'approve');
    }
    return new PurchaseOrder({
      ...this.props,
      status: 'APROBADA',
      updatedAt: new Date(),
    });
  }

  /**
   * Reject: PENDIENTE → RECHAZADA.
   * Throws on any other status.
   * Throws if reason.length < 10 (BR-D2).
   */
  reject(reason: string): PurchaseOrder {
    if (this.props.status !== 'PENDIENTE') {
      throw new OrderInvalidTransitionError(this.props.status, 'reject');
    }
    if (typeof reason !== 'string' || reason.length < 10) {
      throw new RejectionReasonTooShortError(typeof reason === 'string' ? reason.length : 0);
    }
    return new PurchaseOrder({
      ...this.props,
      status: 'RECHAZADA',
      reason,
      updatedAt: new Date(),
    });
  }

  /**
   * Receive: APROBADA → RECIBIDA.
   * Throws on any other status.
   */
  receive(): PurchaseOrder {
    if (this.props.status !== 'APROBADA') {
      throw new OrderInvalidTransitionError(this.props.status, 'receive');
    }
    return new PurchaseOrder({
      ...this.props,
      status: 'RECIBIDA',
      receivedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // ── Accessors ──────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get productId(): string {
    return this.props.productId;
  }
  get quantity(): number {
    return this.props.quantity;
  }
  get status(): OrderStatusType {
    return this.props.status;
  }
  get supplierSnapshot(): string {
    return this.props.supplierSnapshot;
  }
  get fromAlertId(): string | null {
    return this.props.fromAlertId;
  }
  get reason(): string | null {
    return this.props.reason;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get receivedAt(): Date | null {
    return this.props.receivedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Read model for interface layer (JSON serialization). */
  toReadModel(): {
    id: string;
    productId: string;
    quantity: number;
    status: OrderStatusType;
    supplierSnapshot: string;
    fromAlertId: string | null;
    rejectionReason: string | null;
    createdBy: string;
    receivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: this.props.id,
      productId: this.props.productId,
      quantity: this.props.quantity,
      status: this.props.status,
      supplierSnapshot: this.props.supplierSnapshot,
      fromAlertId: this.props.fromAlertId,
      rejectionReason: this.props.reason,
      createdBy: this.props.createdBy,
      receivedAt: this.props.receivedAt?.toISOString() ?? null,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}

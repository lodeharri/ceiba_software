/**
 * Inventory BC — StockMovement aggregate (PR 2b, inventory/spec.md).
 *
 * Pure domain entity — imports nothing from infrastructure.
 * Invariants:
 *   - type ∈ {ENTRADA, SALIDA}
 *   - quantity > 0 (absolute magnitude; sign derived from type, BR-D7/BR-D8)
 *   - reason 3-280 chars
 *   - productId must be a valid UUID
 *
 * The `applyTo(currentStock)` method is the SINGLE writer for stock deltas:
 *   ENTRADA → currentStock + quantity
 *   SALIDA  → currentStock - quantity
 * (BR-D8: sign is derived from MovementType, never set manually.)
 */

import type { MovementType } from '@mercadoexpress/shared';

const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_TYPES: readonly MovementType[] = ['ENTRADA', 'SALIDA'];

export interface StockMovementProps {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  userId: string;
  createdAt: Date;
}

export class StockMovement {
  private constructor(public readonly props: StockMovementProps) {}

  static create(input: {
    id: string;
    productId: string;
    type: MovementType;
    quantity: number;
    reason: string;
    userId: string;
    createdAt?: Date;
  }): StockMovement {
    StockMovement.assertInvariants({
      id: input.id,
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      reason: input.reason,
      userId: input.userId,
      createdAt: input.createdAt ?? new Date(),
    });
    return new StockMovement({
      id: input.id,
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      reason: input.reason,
      userId: input.userId,
      createdAt: input.createdAt ?? new Date(),
    });
  }

  static rehydrate(props: StockMovementProps): StockMovement {
    return new StockMovement(props);
  }

  static assertInvariants(props: StockMovementProps): void {
    if (!VALID_TYPES.includes(props.type)) {
      throw new Error(`StockMovement.type must be ENTRADA or SALIDA, got '${props.type}'`);
    }
    if (!Number.isInteger(props.quantity) || props.quantity <= 0) {
      throw new Error(`StockMovement.quantity must be a positive integer, got ${props.quantity}`);
    }
    if (!props.reason || props.reason.length < 1 || props.reason.length > 280) {
      throw new Error('StockMovement.reason must be 1-280 chars');
    }
    if (!props.productId || !UUID_V4_REGEX.test(props.productId)) {
      throw new Error('StockMovement.productId must be a valid UUID');
    }
    if (!props.id || !UUID_V4_REGEX.test(props.id)) {
      throw new Error('StockMovement.id must be a valid UUID');
    }
    if (!props.userId || !UUID_V4_REGEX.test(props.userId)) {
      throw new Error('StockMovement.userId must be a valid UUID');
    }
  }

  /**
   * The SINGLE writer for stock deltas (BR-D8).
   * Sign is derived from MovementType: ENTRADA → +, SALIDA → -.
   */
  applyTo(currentStock: number): number {
    const delta = this.props.type === 'ENTRADA' ? this.props.quantity : -this.props.quantity;
    return currentStock + delta;
  }

  get id(): string {
    return this.props.id;
  }
  get productId(): string {
    return this.props.productId;
  }
  get type(): MovementType {
    return this.props.type;
  }
  get quantity(): number {
    return this.props.quantity;
  }
  get reason(): string {
    return this.props.reason;
  }
  get userId(): string {
    return this.props.userId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}

/**
 * Alerts BC — Alert aggregate (PR 2b, alerts/spec.md).
 *
 * Pure domain entity — imports nothing from infrastructure.
 * Invariants:
 *   - status ∈ {ACTIVA, RESUELTA}
 *   - type = STOCK_BAJO (only type in MVP)
 *   - resolvedAt set iff status = RESUELTA (BR-4)
 *   - productId must be a valid UUID
 */

const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_STATUSES = ['ACTIVA', 'RESUELTA'] as const;

export type AlertStatusType = (typeof VALID_STATUSES)[number];

export interface AlertProps {
  id: string;
  productId: string;
  status: AlertStatusType;
  type: 'STOCK_BAJO';
  resolvedAt: Date | undefined;
  createdAt: Date;
}

export class Alert {
  private constructor(public readonly props: AlertProps) {}

  static create(input: {
    id: string;
    productId: string;
    status: AlertStatusType;
    resolvedAt?: Date;
    createdAt?: Date;
  }): Alert {
    Alert.assertInvariants({
      id: input.id,
      productId: input.productId,
      status: input.status,
      type: 'STOCK_BAJO',
      resolvedAt: input.resolvedAt,
      createdAt: input.createdAt ?? new Date(),
    });
    return new Alert({
      id: input.id,
      productId: input.productId,
      status: input.status,
      type: 'STOCK_BAJO',
      resolvedAt: input.resolvedAt,
      createdAt: input.createdAt ?? new Date(),
    });
  }

  static rehydrate(props: AlertProps): Alert {
    return new Alert(props);
  }

  static assertInvariants(props: AlertProps): void {
    if (!VALID_STATUSES.includes(props.status)) {
      throw new Error(
        `Alert.status must be one of ${VALID_STATUSES.join(', ')}, got '${props.status}'`,
      );
    }
    if (!props.productId || !UUID_V4_REGEX.test(props.productId)) {
      throw new Error('Alert.productId must be a valid UUID');
    }
    if (!props.id || !UUID_V4_REGEX.test(props.id)) {
      throw new Error('Alert.id must be a valid UUID');
    }
  }

  get id(): string {
    return this.props.id;
  }
  get productId(): string {
    return this.props.productId;
  }
  get status(): AlertStatusType {
    return this.props.status;
  }
  get type(): 'STOCK_BAJO' {
    return this.props.type;
  }
  get resolvedAt(): Date | undefined {
    return this.props.resolvedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  toReadModel(): {
    id: string;
    productId: string;
    status: AlertStatusType;
    type: 'STOCK_BAJO';
    resolvedAt: string | null;
    createdAt: string;
  } {
    return {
      id: this.props.id,
      productId: this.props.productId,
      status: this.props.status,
      type: this.props.type,
      resolvedAt: this.props.resolvedAt?.toISOString() ?? null,
      createdAt: this.props.createdAt.toISOString(),
    };
  }
}

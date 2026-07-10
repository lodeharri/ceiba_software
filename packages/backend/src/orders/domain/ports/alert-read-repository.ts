/**
 * Orders BC — AlertReadRepository port (PR 2c, orders/spec.md).
 *
 * Read-only access to Alert for the Orders BC. Used at create-time
 * to validate that `fromAlertId` references an ACTIVA alert for the
 * same productId (orders/spec.md "fromAlertId must reference an ACTIVA
 * alert for the same productId").
 *
 * Consumed by:
 *   - `orders/application/create-order.ts`
 *
 * Implementation: `orders/infrastructure/prisma-alert-read-repository.ts`.
 *
 * NOTE: `AlertCloserPort` from the alerts BC is used for the receive
 * flow (close-if-above-min), not this read-only repository.
 */

export interface AlertReadModel {
  id: string;
  productId: string;
  status: 'ACTIVA' | 'RESUELTA';
}

export interface AlertReadRepository {
  findById(id: string): Promise<AlertReadModel | null>;
}

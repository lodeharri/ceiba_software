/**
 * Orders BC — AlertCloserPort re-export (PR 2c, orders/spec.md).
 *
 * Re-exports the `AlertCloserPort` interface owned by the alerts BC.
 * The Orders BC uses it inside the atomic receive flow (ADR-3) to close
 * an ACTIVA alert when stock recovers above stockMin.
 *
 * The `AlertCloserPort.txCloseIfOpenAndAboveMin(tx, args)` is called inside
 * `prisma.$transaction` by `ReceiveOrderUseCase`.
 */

export type { AlertCloserPort } from '../../../alerts/domain/ports/alert-closer-port.js';

/**
 * Orders BC — ProductStockGate port (PR 2c, orders/spec.md).
 *
 * Re-exports the `ProductStockGate` interface owned by the inventory BC.
 * The Orders BC uses it inside the atomic receive flow (ADR-3).
 *
 * The `ProductStockGate.txIncrementStock(tx, args)` is called inside
 * `prisma.$transaction` by `ReceiveOrderUseCase`.
 */

export type {
  ProductStockGate,
  StockMovementRecorded,
} from '../../../inventory/domain/ports/product-stock-gate.js';

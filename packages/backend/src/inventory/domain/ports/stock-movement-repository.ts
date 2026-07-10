/**
 * Inventory BC — StockMovementRepository port (PR 2b, inventory/spec.md).
 *
 * Append-only per BR-6: no `update` or `delete` methods.
 * The repository is the ONLY persistence seam for StockMovement rows.
 */

import type { StockMovementProps } from '../stock-movement.js';

export interface StockMovementRepository {
  append(movement: StockMovementProps): Promise<void>;
  listByProduct(args: {
    productId: string;
    page: number;
    size: number;
  }): Promise<{ items: StockMovementProps[]; total: number }>;
}

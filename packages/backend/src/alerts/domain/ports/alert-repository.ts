/**
 * Alerts BC — AlertRepository port (PR 2b, alerts/spec.md).
 *
 * Read-side repository. Manual creation is forbidden (alerts/spec.md).
 * Mutation happens only through:
 *   - AlertCloserPort.txCloseIfOpenAndAboveMin (close)
 *   - StockMutationService (open, via direct tx.alert.create)
 */

import type { AlertProps } from '../alert.js';

export interface AlertRepository {
  findById(id: string): Promise<AlertProps | null>;
  list(args: {
    status?: 'ACTIVA' | 'RESUELTA';
    page: number;
    size: number;
  }): Promise<{ items: AlertProps[]; total: number }>;
  count(args: { status?: 'ACTIVA' | 'RESUELTA' }): Promise<number>;
}

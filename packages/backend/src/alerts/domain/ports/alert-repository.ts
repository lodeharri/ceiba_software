/**
 * Alerts BC — AlertRepository port (PR 2b, alerts/spec.md).
 *
 * Read-side repository. Manual creation is forbidden (alerts/spec.md).
 * Mutation happens only through:
 *   - AlertCloserPort.txCloseIfOpenAndAboveMin (close)
 *   - StockMutationService (open, via direct tx.alert.create)
 */

import type { AlertProps } from '../alert.js';

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

export interface ListAlertsOptions {
  status?: 'ACTIVA' | 'RESUELTA';
  page: number;
  size: number;
}

export interface AlertRepository {
  findById(id: string): Promise<AlertProps | null>;
  list(args: ListAlertsOptions): Promise<Page<AlertProps>>;
  count(args: { status?: 'ACTIVA' | 'RESUELTA' }): Promise<number>;
}

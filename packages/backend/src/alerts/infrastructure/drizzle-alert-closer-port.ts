/**
 * Alerts BC — DrizzleAlertCloserPort (PR 1.2, design.md §5.3).
 *
 * Adapter implementing AlertCloserPort against a Drizzle transaction.
 * Replaces `PrismaAlertCloserPort` for the Prisma → Drizzle migration.
 *
 * Executes the UPDATE ... WHERE status = 'ACTIVA' RETURNING id inside
 * the supplied tx. Idempotent: if no active alert exists, returns null.
 */

import type { AlertCloserPort } from '../domain/ports/alert-closer-port.js';
import type { TransactionContext } from '../../shared/domain/ports/unit-of-work.js';

export class DrizzleAlertCloserPort implements AlertCloserPort {
  async txCloseIfOpenAndAboveMin(
    tx: unknown,
    args: { productId: string; newStock: number; stockMin: number },
  ): Promise<{ alertId: string } | null> {
    // BR-4: only close when stock recovers ABOVE the minimum.
    if (args.newStock <= args.stockMin) {
      return null;
    }

    const ctx = tx as TransactionContext;
    return ctx.closeAlertIfAboveMin({
      productId: args.productId,
      newStock: args.newStock,
      stockMin: args.stockMin,
    });
  }
}

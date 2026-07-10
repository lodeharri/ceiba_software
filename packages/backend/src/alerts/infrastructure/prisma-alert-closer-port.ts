/**
 * Alerts BC — PrismaAlertCloserPort (PR 2b, design.md §5.3).
 *
 * Adapter implementing AlertCloserPort against a Prisma transaction.
 * Executes the UPDATE … WHERE status = 'ACTIVA' RETURNING id inside
 * the supplied tx. Idempotent: if no active alert exists, returns null.
 */

import type { AlertCloserPort } from '../domain/ports/alert-closer-port.js';

/**
 * Prisma 5.x: model accessors are class getters that TS Omit strips.
 * Use any for tx type — runtime object IS the transaction proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

interface CloseResult {
  id: string;
}

export class PrismaAlertCloserPort implements AlertCloserPort {
  async txCloseIfOpenAndAboveMin(
    tx: TxClient,
    args: { productId: string; newStock: number; stockMin: number },
  ): Promise<{ alertId: string } | null> {
    // BR-4: only close when stock recovers ABOVE the minimum.
    // newStock <= stockMin → no-op (alert stays open).
    if (args.newStock <= args.stockMin) {
      return null;
    }

    const rows = await tx.$queryRaw<CloseResult[]>`
      UPDATE alerts
      SET status = 'RESUELTA', resolved_at = NOW()
      WHERE product_id = ${args.productId}::uuid
        AND status = 'ACTIVA'
      RETURNING id
    `;

    if (rows.length === 0) {
      return null;
    }

    return { alertId: rows[0]!.id };
  }
}

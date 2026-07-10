/**
 * Products BC — PrismaAlertReadModel (KL-13, products/spec.md
 * "List with filters" — cross-BC seam to the alerts BC).
 *
 * Adapter implementing `AlertReadModelPort` against `@prisma/client`.
 * The adapter queries the `alerts` table directly via `productId` as an
 * opaque value column — there is NO Prisma relation between `products`
 * and `alerts` per design.md §4 ("cross-BC FKs are forbidden").
 *
 * Why this lives in `products/infrastructure/` and not
 * `alerts/infrastructure/`: the *read* port is owned by the *consumer*
 * (products). The alerts BC never imports from this file — symmetry
 * with `AlertCloserPort` / `ProductReadPort` (RISK-W06).
 */

import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';

interface AlertIdRow {
  productId: string;
}

/** Minimal Prisma surface the alert read-model needs. */
export interface AlertReadModelPrisma {
  alert: {
    findMany(args: {
      where: { status: string };
      select: { productId: true };
    }): Promise<AlertIdRow[]>;
  };
}

export class PrismaAlertReadModel implements AlertReadModelPort {
  constructor(private readonly prisma: AlertReadModelPrisma) {}

  async findProductIdsWithActiveAlert(): Promise<readonly string[]> {
    const rows = await this.prisma.alert.findMany({
      where: { status: 'ACTIVA' },
      select: { productId: true },
    });
    // Deduplicate server-side: BR-4 enforces ≤ 1 ACTIVA alert per
    // productId, but the partial unique index is a DB-level guarantee,
    // and we may have stale rows above the threshold during a race
    // window. Dedupe in TS to be safe.
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.productId);
    return [...seen];
  }
}

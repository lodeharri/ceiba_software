/**
 * Products BC — DrizzleAlertReadModel (KL-13, products/spec.md
 * "List with filters" — cross-BC seam to the alerts BC).
 *
 * Adapter implementing `AlertReadModelPort` against Drizzle ORM.
 * Replaces `PrismaAlertReadModel` for the Prisma → Drizzle migration.
 */

import { eq, sql } from 'drizzle-orm';
import type { AlertReadModelPort } from '../domain/ports/alert-read-model-port.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleAlertReadModel implements AlertReadModelPort {
  constructor(private readonly db = getDb()) {}

  async findProductIdsWithActiveAlert(): Promise<readonly string[]> {
    const rows = await this.db
      .select({ productId: schema.alerts.productId })
      .from(schema.alerts)
      .where(eq(schema.alerts.status, 'ACTIVA'));

    // Deduplicate: BR-4 enforces ≤ 1 ACTIVA alert per productId,
    // but we dedupe in TS to be safe.
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.productId);
    return [...seen];
  }

  async hasActiveAlert(productId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`1` })
      .from(schema.alerts)
      .where(eq(schema.alerts.productId, productId))
      .limit(1);
    return row !== undefined;
  }
}

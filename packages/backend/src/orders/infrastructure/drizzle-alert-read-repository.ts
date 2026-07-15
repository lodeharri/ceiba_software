/**
 * Orders BC — DrizzleAlertReadRepository (PR 1.2).
 *
 * Read-only adapter implementing `AlertReadRepository`.
 * Replaces `PrismaAlertReadRepository` for the Prisma → Drizzle migration.
 */

import { eq } from 'drizzle-orm';
import type { AlertReadRepository, AlertReadModel } from '../domain/ports/alert-read-repository.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleAlertReadRepository implements AlertReadRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<AlertReadModel | null> {
    const [row] = await this.db
      .select({
        id: schema.alerts.id,
        productId: schema.alerts.productId,
        status: schema.alerts.status,
      })
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      productId: row.productId,
      status: row.status as 'ACTIVA' | 'RESUELTA',
    };
  }
}

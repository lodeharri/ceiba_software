/**
 * Alerts BC — DrizzleAlertOpenerPort (PR 1.2).
 *
 * Adapter implementing AlertOpenerPort against Drizzle ORM.
 * Replaces `PrismaAlertOpenerPort` for the Prisma → Drizzle migration.
 *
 * Idempotent: if an ACTIVA alert already exists for the product, the call
 * swallows the unique_violation error (pg code 23505) from the BR-4 partial
 * unique index and returns cleanly.
 */

import { randomUUID } from 'node:crypto';
import type { AlertOpenerPort } from '../domain/ports/alert-opener-port.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleAlertOpenerPort implements AlertOpenerPort {
  constructor(private readonly db = getDb()) {}

  async openIfAbsent(productId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(schema.alerts).values({
          id: randomUUID(),
          productId,
          type: 'STOCK_BAJO',
          status: 'ACTIVA',
        });
      });
    } catch (e: unknown) {
      // pg unique_violation code = 23505 (same semantic as Prisma P2002)
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: string }).code === '23505'
      ) {
        return;
      }
      throw e;
    }
  }
}

/**
 * Alerts BC — DrizzleAlertRepository (PR 1.2, alerts/spec.md).
 *
 * Read-only adapter implementing AlertRepository.
 * Replaces `PrismaAlertRepository` for the Prisma → Drizzle migration.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { AlertRepository, ListAlertsOptions, Page } from '../domain/ports/alert-repository.js';
import type { AlertProps } from '../domain/alert.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

interface DrizzleAlertRow {
  id: string;
  productId: string;
  status: string;
  type: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

export class DrizzleAlertRepository implements AlertRepository {
  constructor(private readonly db = getDb()) {}

  async findById(id: string): Promise<AlertProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .limit(1);
    return row ? toProps(row) : null;
  }

  async list(args: ListAlertsOptions): Promise<Page<AlertProps>> {
    const page = args.page;
    const size = args.size;
    const where = args.status ? eq(schema.alerts.status, args.status) : undefined;

    const items = await this.db
      .select()
      .from(schema.alerts)
      .where(where)
      .orderBy(desc(schema.alerts.createdAt))
      .limit(size)
      .offset((page - 1) * size);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.alerts)
      .where(where)
      .limit(1);

    return {
      items: items.map(toProps),
      page,
      size,
      total: countRow?.count ?? 0,
      hasMore: page * size < (countRow?.count ?? 0),
    };
  }

  async count(args: { status?: 'ACTIVA' | 'RESUELTA' }): Promise<number> {
    const where = args.status ? eq(schema.alerts.status, args.status) : undefined;
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.alerts)
      .where(where)
      .limit(1);
    return row?.count ?? 0;
  }
}

function toProps(row: DrizzleAlertRow): AlertProps {
  return {
    id: row.id,
    productId: row.productId,
    status: row.status as AlertProps['status'],
    type: row.type as AlertProps['type'],
    resolvedAt: row.resolvedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

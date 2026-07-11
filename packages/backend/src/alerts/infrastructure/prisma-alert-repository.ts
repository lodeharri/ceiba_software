/**
 * Alerts BC — PrismaAlertRepository (PR 2b, alerts/spec.md).
 *
 * Read-only adapter implementing AlertRepository.
 * Manual creation is forbidden — alerts are created by inventory BC only.
 * No create/update/delete methods.
 */

import type { AlertRepository, ListAlertsOptions, Page } from '../domain/ports/alert-repository.js';
import type { AlertProps } from '../domain/alert.js';

interface AlertRow {
  id: string;
  productId: string;
  status: string;
  type: string;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Minimal Prisma surface the alert repository needs. */
export interface AlertPrisma {
  alert: {
    findUnique(args: { where: { id: string } }): Promise<AlertRow | null>;
    findMany(args: {
      where: { status?: string };
      orderBy: { createdAt: 'desc' | 'asc' };
      skip: number;
      take: number;
    }): Promise<AlertRow[]>;
    count(args: { where: { status?: string } }): Promise<number>;
  };
}

export class PrismaAlertRepository implements AlertRepository {
  constructor(private readonly prisma: AlertPrisma) {}

  async findById(id: string): Promise<AlertProps | null> {
    const row = await this.prisma.alert.findUnique({ where: { id } });
    return row ? toProps(row) : null;
  }

  async list(args: ListAlertsOptions): Promise<Page<AlertProps>> {
    const page = args.page;
    const size = args.size;
    const where = args.status ? { status: args.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.alert.count({ where }),
    ]);
    return {
      items: rows.map(toProps),
      page,
      size,
      total,
      hasMore: page * size < total,
    };
  }

  async count(args: { status?: 'ACTIVA' | 'RESUELTA' }): Promise<number> {
    return this.prisma.alert.count({ where: args.status ? { status: args.status } : {} });
  }
}

function toProps(row: AlertRow): AlertProps {
  return {
    id: row.id,
    productId: row.productId,
    status: row.status as AlertProps['status'],
    type: row.type as AlertProps['type'],
    resolvedAt: row.resolvedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

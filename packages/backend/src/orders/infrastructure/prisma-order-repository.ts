/**
 * Orders BC — PrismaOrderRepository (PR 2c).
 *
 * Adapter implementing `OrderRepository` against `@prisma/client`.
 *
 * The `PurchaseOrder` table is in the same Postgres DB as the other BCs.
 * No Prisma relation to Product/Alert — productId/alertId are value references.
 */

import type { OrderRepository, ListOrdersOptions } from '../domain/ports/order-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';

interface PrismaOrderRow {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  supplierSnapshot: string;
  fromAlertId: string | null;
  reason: string | null;
  createdBy: string;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal Prisma surface for the order repository. */
export interface OrderPrisma {
  purchaseOrder: {
    create(args: { data: Record<string, unknown> }): Promise<PrismaOrderRow>;
    findUnique(args: { where: { id: string } }): Promise<PrismaOrderRow | null>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, string>;
      skip: number;
      take: number;
    }): Promise<PrismaOrderRow[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaOrderRow>;
  };
}

/** Minimal tx-like surface needed by txUpdate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxLike = any;

function rowToProps(row: PrismaOrderRow): PurchaseOrderProps {
  return {
    id: row.id,
    productId: row.productId,
    quantity: row.quantity,
    status: row.status as PurchaseOrderProps['status'],
    supplierSnapshot: row.supplierSnapshot,
    fromAlertId: row.fromAlertId,
    reason: row.reason,
    createdBy: row.createdBy,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: OrderPrisma) {}

  async create(props: PurchaseOrderProps): Promise<PurchaseOrderProps> {
    const row = await this.prisma.purchaseOrder.create({
      data: {
        id: props.id,
        product_id: props.productId,
        quantity: props.quantity,
        status: props.status,
        supplier_snapshot: props.supplierSnapshot,
        from_alert_id: props.fromAlertId,
        reason: props.reason,
        created_by: props.createdBy,
        received_at: props.receivedAt,
        created_at: props.createdAt,
        updated_at: props.updatedAt,
      },
    });
    return rowToProps(row);
  }

  async findById(id: string): Promise<PurchaseOrderProps | null> {
    const row = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    return row ? rowToProps(row) : null;
  }

  async list(opts: ListOrdersOptions): Promise<{
    items: PurchaseOrderProps[];
    page: number;
    size: number;
    total: number;
    hasMore: boolean;
  }> {
    const where: Record<string, unknown> = {};
    if (opts.productId) where.product_id = opts.productId;
    if (opts.status) where.status = opts.status;

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (opts.page - 1) * opts.size,
        take: opts.size,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      items: rows.map(rowToProps),
      page: opts.page,
      size: opts.size,
      total,
      hasMore: opts.page * opts.size < total,
    };
  }

  async updateStatus(
    id: string,
    status: PurchaseOrderProps['status'],
    reason?: string,
  ): Promise<PurchaseOrderProps> {
    const data: Record<string, unknown> = {
      status,
      updated_at: new Date(),
    };
    if (reason !== undefined) {
      data.reason = reason;
    }
    if (status === 'RECIBIDA') {
      data.received_at = new Date();
    }
    const row = await this.prisma.purchaseOrder.update({ where: { id }, data });
    return rowToProps(row);
  }

  async txUpdate(
    tx: unknown,
    id: string,
    status: PurchaseOrderProps['status'],
  ): Promise<PurchaseOrderProps> {
    const client = (tx as TxLike) ?? this.prisma;
    const data: Record<string, unknown> = {
      status,
      updated_at: new Date(),
    };
    if (status === 'RECIBIDA') {
      data.received_at = new Date();
    }
    const row = await client.purchaseOrder.update({ where: { id }, data });
    return rowToProps(row);
  }
}

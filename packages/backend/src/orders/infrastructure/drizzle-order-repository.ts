/**
 * Orders BC — DrizzleOrderRepository (PR 1.2).
 *
 * Adapter implementing `OrderRepository` against Drizzle ORM.
 * Replaces `PrismaOrderRepository` for the Prisma → Drizzle migration.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { OrderRepository, ListOrdersOptions } from '../domain/ports/order-repository.js';
import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

interface DrizzleOrderRow {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

function rowToProps(row: DrizzleOrderRow): PurchaseOrderProps {
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

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db = getDb()) {}

  async create(props: PurchaseOrderProps): Promise<PurchaseOrderProps> {
    const rows = await this.db
      .insert(schema.purchaseOrders)
      .values({
        id: props.id,
        productId: props.productId,
        quantity: props.quantity,
        status: props.status,
        supplierSnapshot: props.supplierSnapshot,
        fromAlertId: props.fromAlertId,
        reason: props.reason,
        createdBy: props.createdBy,
        receivedAt: props.receivedAt,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
      })
      .returning();
    return rowToProps(rows[0]!);
  }

  async findById(id: string): Promise<PurchaseOrderProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, id))
      .limit(1);
    return row ? rowToProps(row) : null;
  }

  async findByIdTx(tx: unknown, id: string): Promise<PurchaseOrderProps | null> {
    const client = tx as TxClient;
    const [row] = await client
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, id))
      .limit(1);
    return row ? rowToProps(row) : null;
  }

  async list(opts: ListOrdersOptions): Promise<{
    items: PurchaseOrderProps[];
    page: number;
    size: number;
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];
    if (opts.productId) conditions.push(eq(schema.purchaseOrders.productId, opts.productId));
    if (opts.status) conditions.push(eq(schema.purchaseOrders.status, opts.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.purchaseOrders)
        .where(where)
        .orderBy(desc(schema.purchaseOrders.createdAt))
        .limit(opts.size)
        .offset((opts.page - 1) * opts.size),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.purchaseOrders)
        .where(where)
        .limit(1),
    ]);

    return {
      items: items.map(rowToProps),
      page: opts.page,
      size: opts.size,
      total: countRow?.count ?? 0,
      hasMore: opts.page * opts.size < (countRow?.count ?? 0),
    };
  }

  async updateStatus(
    id: string,
    status: PurchaseOrderProps['status'],
    reason?: string,
  ): Promise<PurchaseOrderProps> {
    const setValues: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (reason !== undefined) setValues.reason = reason;
    if (status === 'RECIBIDA') setValues.receivedAt = new Date();

    const rows = await this.db
      .update(schema.purchaseOrders)
      .set(setValues)
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return rowToProps(rows[0]!);
  }

  async txUpdate(
    tx: unknown,
    id: string,
    status: PurchaseOrderProps['status'],
  ): Promise<PurchaseOrderProps> {
    const client = tx as TxClient;
    const setValues: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (status === 'RECIBIDA') setValues.receivedAt = new Date();

    const rows = await client
      .update(schema.purchaseOrders)
      .set(setValues)
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return rowToProps(rows[0]!);
  }
}

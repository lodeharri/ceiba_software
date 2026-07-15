/**
 * Drizzle Unit of Work implementation.
 *
 * Uses Drizzle + node-postgres with a single pool connection during the
 * transaction (BEGIN / COMMIT / ROLLBACK). The context exposes only the
 * methods the domain needs.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { UnitOfWork, TransactionContext } from '../domain/ports/unit-of-work.js';

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async execute<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const db = drizzle(client, { schema });
      const ctx = new DrizzleTransactionContext(db, client);
      const result = await work(ctx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

class DrizzleTransactionContext implements TransactionContext {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly client: PoolClient,
  ) {}

  async findProductForUpdate(productId: string) {
    const result = await this.client.query(
      'SELECT id, stock, stock_min FROM products WHERE id = $1::uuid FOR UPDATE',
      [productId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, stock: Number(row.stock), stockMin: Number(row.stock_min) };
  }

  async updateProductStock(productId: string, newStock: number) {
    await this.db
      .update(schema.products)
      .set({ stock: newStock })
      .where(eq(schema.products.id, productId));
  }

  async insertStockMovement(input: {
    id: string;
    productId: string;
    type: 'ENTRADA' | 'SALIDA';
    quantity: number;
    reason: string;
    userId: string;
    stockAfter: number;
    createdAt: Date;
  }) {
    await this.db.insert(schema.stockMovements).values(input);
  }

  async openAlertIfAbsent(input: { id: string; productId: string; type: string }) {
    try {
      await this.db.insert(schema.alerts).values({
        id: input.id,
        productId: input.productId,
        type: input.type as 'STOCK_BAJO',
        status: 'ACTIVA',
      });
    } catch (e: unknown) {
      // pg unique_violation code = 23505
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

  async closeAlertIfAboveMin(input: {
    productId: string;
    stockMin: number;
    newStock: number;
  }): Promise<{ alertId: string } | null> {
    if (input.newStock <= input.stockMin) return null;
    const [alert] = await this.db
      .update(schema.alerts)
      .set({ status: 'RESUELTA', resolvedAt: new Date() })
      .where(and(eq(schema.alerts.productId, input.productId), eq(schema.alerts.status, 'ACTIVA')))
      .returning({ id: schema.alerts.id });
    return alert ? { alertId: alert.id } : null;
  }
}

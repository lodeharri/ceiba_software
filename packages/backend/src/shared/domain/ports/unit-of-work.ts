/**
 * Unit of Work — port agnostic to ORM.
 *
 * Allows use cases to execute atomic operations (transactions) without
 * knowledge of the underlying ORM. Implementations live in infrastructure/
 * (DrizzleUnitOfWork, or future KyselyUnitOfWork, PrismaUnitOfWork, etc.).
 *
 * Design: the `execute(work)` callback receives a `TransactionContext` with
 * domain-specific methods. This prevents use cases from knowing SQL or the ORM.
 */

export interface UnitOfWork {
  execute<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Transaction context — minimal surface use cases need.
 * Defines domain operations, not ORM queries.
 */
export interface TransactionContext {
  // Products
  findProductForUpdate(
    productId: string,
  ): Promise<{ id: string; stock: number; stockMin: number } | null>;
  updateProductStock(productId: string, newStock: number): Promise<void>;

  // Stock movements
  insertStockMovement(input: {
    id: string;
    productId: string;
    type: 'ENTRADA' | 'SALIDA';
    quantity: number;
    reason: string;
    userId: string;
    stockAfter: number;
    createdAt: Date;
  }): Promise<void>;

  // Alerts
  openAlertIfAbsent(input: { id: string; productId: string; type: string }): Promise<void>;
  closeAlertIfAboveMin(input: {
    productId: string;
    stockMin: number;
    newStock: number;
  }): Promise<{ alertId: string } | null>;
}

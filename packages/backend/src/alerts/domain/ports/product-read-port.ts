/**
 * Alerts BC — ProductReadPort (PR 2b, alerts/spec.md).
 *
 * Read-only port to fetch a product snapshot for alert read models.
 * Alerts are enriched with product data at read time.
 * The port is owned by alerts BC; the adapter lives in alerts/infrastructure/.
 */

export interface ProductSnapshot {
  id: string;
  name: string;
  sku: string;
  stock: number;
  stockMin: number;
}

export interface ProductReadPort {
  findById(id: string): Promise<ProductSnapshot | null>;
}

/**
 * Alerts BC — compose helper (mirrors orders BC `composeOrder`).
 *
 * Builds the flat read-model shape required by the shared contract
 * (`packages/shared/src/schemas/alerts/alert.ts`) from an `AlertProps`
 * row and its joined `ProductSnapshot`.
 *
 * The frontend (`packages/frontend/src/services/alerts.ts`) imports the
 * `Alert` type from that shared schema and treats every list item /
 * detail payload as the flat shape — never as `{ alert, product }`. This
 * helper is the single source of truth for that composition, shared by
 * `ListAlerts` and `GetAlert` use cases.
 *
 * `stockAtOpen` and `stockMin` are populated from the current product
 * snapshot at read time. The shared schema's `stockAtOpen` field is
 * therefore "stock at read time" rather than "stock at open time" — the
 * schema was named for the domain intent, but the alert row does not
 * persist the historical stock (alerts/spec.md §"product snapshot" uses
 * the live product snapshot for the read model).
 */

import type { AlertProps } from '../domain/alert.js';
import type { ProductSnapshot } from '../domain/ports/product-read-port.js';

export interface AlertReadModel {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  stockAtOpen: number;
  stockMin: number;
  status: AlertProps['status'];
  resolvedAt: string | null;
  createdAt: string;
}

export function composeAlert(alert: AlertProps, product: ProductSnapshot): AlertReadModel {
  return {
    id: alert.id,
    productId: alert.productId,
    productName: product.name,
    productSku: product.sku,
    stockAtOpen: product.stock,
    stockMin: product.stockMin,
    status: alert.status,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
  };
}

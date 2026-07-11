/**
 * Orders BC — compose helper (PR 2c, orders/spec.md).
 *
 * Builds the flat read-model shape required by the shared contract
 * (`packages/shared/src/schemas/orders/order.ts`) from a `PurchaseOrder`
 * row and its joined `Product` snapshot.
 *
 * The frontend (`packages/frontend/src/services/orders.ts`) imports the
 * `Order` type from that shared schema and treats every list item / detail
 * payload as the flat shape — never as `{ order, product }`. This helper
 * is the single source of truth for that composition, shared by
 * `ListOrdersUseCase` and `GetOrderUseCase`.
 *
 * Mirrors the alerts BC `composeAlert` pattern (see
 * `packages/backend/src/alerts/application/list-alerts.ts`).
 */

import type { PurchaseOrderProps } from '../domain/purchase-order.js';
import type { ProductReadModel } from '../domain/ports/product-read-repository.js';

export interface OrderReadModel {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  supplierSnapshot: string;
  fromAlertId: string | null;
  status: PurchaseOrderProps['status'];
  rejectionReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
}

export function composeOrder(order: PurchaseOrderProps, product: ProductReadModel): OrderReadModel {
  return {
    id: order.id,
    productId: order.productId,
    productName: product.name,
    productSku: product.sku,
    quantity: order.quantity,
    supplierSnapshot: order.supplierSnapshot,
    fromAlertId: order.fromAlertId,
    status: order.status,
    rejectionReason: order.reason,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    receivedAt: order.receivedAt?.toISOString() ?? null,
  };
}

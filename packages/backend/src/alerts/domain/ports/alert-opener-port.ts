/**
 * Alerts BC — AlertOpenerPort (RF-03 / BR-4).
 *
 * Port interface owned by the `alerts` BC. Consumed by:
 *   - `products/application/create-product.ts` (creation-time alert trigger)
 *
 * The port must be idempotent: if an ACTIVA alert already exists for the
 * product, the call is a no-op (swallows P2002 from the partial unique index).
 */

/**
 * Prisma 5.x: model accessors are class getters that TS Omit strips.
 * Use any for tx type — runtime object IS the transaction proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

export const ALERT_OPENER_PORT = Symbol('AlertOpenerPort');

export interface AlertOpenerPort {
  /**
   * Creates a STOCK_BAJO alert for productId IF no ACTIVA alert exists yet.
   * Idempotent: multiple calls do NOT duplicate alerts.
   *
   * Can be called outside a transaction (products BC) — the adapter wraps the
   * create in a small Prisma transaction internally.
   */
  openIfAbsent(productId: string): Promise<void>;
}

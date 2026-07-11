/**
 * Inventory BC — shared path-utilities (PR 2b).
 *
 * Extracts path parameters from API Gateway v2 rawPath.
 *
 * NOTE: APIGW v2 strips the stage prefix from rawPath. The dev-server
 * matches the production wire format exactly, so the prefix is NOT
 * present here. (Route templates with `{id}` are matched separately by
 * the dev-server's `matchRoute` before the handler is invoked.)
 */

/** UUID v4 pattern extracted from the productId path segment. */
const PRODUCT_ID_IN_MOVEMENTS = /^\/products\/(?<productId>[0-9a-fA-F-]{36})\/movements/;

/**
 * Extracts the productId UUID from a rawPath like
 * `/products/{uuid}/movements`.
 *
 * Returns null if the path doesn't match or the productId segment
 * doesn't look like a UUID.
 */
export function extractProductId(rawPath: string): string | null {
  const match = PRODUCT_ID_IN_MOVEMENTS.exec(rawPath);
  return match?.groups?.productId ?? null;
}

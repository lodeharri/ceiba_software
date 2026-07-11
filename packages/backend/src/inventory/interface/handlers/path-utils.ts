/**
 * Inventory BC — shared path-utilities (PR 2b).
 *
 * Extracts path parameters from API Gateway v2 rawPath.
 *
 * NOTE: APIGW v2 rawPath includes the stage prefix (e.g., `/api/v1`).
 * The regex must match the full rawPath format.
 */

/** UUID v4 pattern extracted from the productId path segment. */
const PRODUCT_ID_IN_MOVEMENTS = /^\/api\/v1\/products\/(?<productId>[0-9a-fA-F-]{36})\/movements/;

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

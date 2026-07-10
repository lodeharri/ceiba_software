/**
 * Orders BC — path utilities (PR 2c).
 *
 * Extracts path parameters from API Gateway v2 rawPath.
 */

const ORDER_ID_REGEX = /\/api\/v1\/orders\/(?<orderId>[0-9a-fA-F-]{36})/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Extracts the orderId UUID from a rawPath like
 * `/api/v1/orders/{uuid}` or `/api/v1/orders/{uuid}/approve`.
 *
 * Returns null if the path doesn't match or the id segment doesn't look like a UUID.
 */
export function extractOrderId(rawPath: string): string | null {
  const match = ORDER_ID_REGEX.exec(rawPath);
  const id = match?.groups?.orderId ?? null;
  if (!id) return null;
  return UUID_PATTERN.test(id) ? id : null;
}

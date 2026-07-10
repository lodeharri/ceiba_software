/**
 * SHA-256 idempotency hash (RISK-S07).
 * Given a request body object, returns a stable key-sorted canonical JSON string
 * hashed with SHA-256 (Web Crypto API). The same logical body always produces
 * the same hash regardless of field order.
 *
 * Usage:
 *   const key = sha256OfSortedJson(body);
 *   // → 'a3f2…' (64-char hex)
 *
 * Fallback: if Web Crypto is unavailable (e.g. Node < 18), the function throws.
 * The SPA only runs in modern browsers that support `crypto.subtle`.
 */

export async function sha256OfSortedJson(body: unknown): Promise<string> {
  const sorted = JSON.stringify(sortObject(body));
  const encoded = new TextEncoder().encode(sorted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Recursively sort object keys alphabetically so JSON.stringify produces
 * the same string regardless of insertion order.
 */
function sortObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortObject);
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortObject((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

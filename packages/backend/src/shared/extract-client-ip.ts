/**
 * Extract Client IP (PR 1, RISK-W03).
 *
 * AWS API Gateway populates `event.requestContext.http.sourceIp` with
 * the immediate caller's IP, but the moment a CloudFront distribution
 * sits in front of the API the `sourceIp` is the CloudFront edge IP
 * and the real client IP is in `X-Forwarded-For`.
 *
 * The depth of trust is environment-controlled via
 * `TRUSTED_PROXY_DEPTH` (default 0):
 *   - 0: API Gateway only (no proxy in front) — use sourceIp.
 *   - 1: CloudFront in front — read the first hop from XFF.
 *   - N: N trusted hops — read the Nth-from-the-right hop.
 *
 * The env is read at module load time so each handler invocation does
 * not reparse the int. Tests mutate the env via `process.env[...]`.
 */

export interface SourceLike {
  sourceIp: string;
  headers: Record<string, string | undefined>;
}

function trustedProxyDepth(): number {
  const raw = process.env['TRUSTED_PROXY_DEPTH'];
  if (raw === undefined || raw === '') return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Parses `X-Forwarded-For` into its comma-separated hops, trimmed,
 * empty entries dropped.
 */
function parseXff(headers: Record<string, string | undefined>): string[] {
  const raw = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  if (!raw) return [];
  return raw
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
}

/**
 * Returns the perceived client IP for the given request. The
 * `TRUSTED_PROXY_DEPTH` env var controls how many trailing hops are
 * trusted proxies; the first non-trusted hop (left-most after the
 * trusted suffix) is the client.
 *
 * Examples (TRUSTED_PROXY_DEPTH = 1, sourceIp = CloudFront edge):
 *   - XFF = "5.6.7.8, 10.0.0.1"   → returns "5.6.7.8"
 *   - XFF = "5.6.7.8"             → returns "5.6.7.8"
 *   - XFF = "" (missing)          → returns sourceIp
 */
export function extractClientIp(event: SourceLike): string {
  const hops = parseXff(event.headers);
  if (hops.length === 0) return event.sourceIp;

  const depth = trustedProxyDepth();
  // The right-most `depth` hops are trusted proxies; the first non-
  // trusted hop is the real client. If we don't have enough hops to
  // peel off `depth`, fall back to the left-most (most-client) hop.
  const idx = Math.max(0, hops.length - 1 - depth);
  return hops[idx] ?? event.sourceIp;
}

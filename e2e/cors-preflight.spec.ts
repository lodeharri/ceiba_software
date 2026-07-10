import { test, expect } from '@playwright/test';

/**
 * E2E: CORS Preflight (RISK-002)
 * Verifies OPTIONS request returns correct CORS headers
 */
test('CORS: preflight returns correct headers', async ({ request, baseURL }) => {
  const response = await request.fetch(`${baseURL}/api/v1/products`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.cloudfront.net',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type,Authorization,X-Request-Id,Idempotency-Key',
    },
  });

  // CORS preflight should succeed
  expect(response.status()).toBe(204);

  // Verify CORS headers
  const headers = response.headers();
  expect(headers['access-control-allow-origin']).toBeDefined();
  expect(headers['access-control-allow-methods']).toContain('GET');
  expect(headers['access-control-allow-methods']).toContain('POST');
  expect(headers['access-control-allow-methods']).toContain('PATCH');
  expect(headers['access-control-allow-methods']).toContain('OPTIONS');

  // Required headers per design
  const allowedHeaders = headers['access-control-allow-headers']?.toLowerCase() ?? '';
  expect(allowedHeaders).toContain('content-type');
  expect(allowedHeaders).toContain('authorization');
  expect(allowedHeaders).toContain('x-request-id');
  expect(allowedHeaders).toContain('idempotency-key');

  // maxAge should be 1 hour (3600 seconds)
  expect(headers['access-control-max-age']).toBe('3600');
});

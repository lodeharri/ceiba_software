/**
 * RED-first test for extract-client-ip (PR 1, tasks.md §2 PR 1).
 *
 * Asserts:
 *   - No XFF, sourceIp=1.2.3.4 → returns '1.2.3.4'
 *   - XFF: '5.6.7.8', trusted depth 0 → returns '5.6.7.8'
 *   - XFF: '5.6.7.8, 10.0.0.1', trusted depth 1 → returns '5.6.7.8'
 *   - XFF: '5.6.7.8, 10.0.0.1, 10.0.0.2', trusted depth 2 → returns '5.6.7.8'
 *   - Missing headers fallback to sourceIp
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('extractClientIp', () => {
  beforeEach(() => {
    delete process.env['TRUSTED_PROXY_DEPTH'];
  });

  it('returns sourceIp when X-Forwarded-For is missing', async () => {
    const { extractClientIp } = await import('../../src/shared/extract-client-ip.js');
    const ip = extractClientIp({
      sourceIp: '1.2.3.4',
      headers: {},
    });
    expect(ip).toBe('1.2.3.4');
  });

  it('returns the single XFF entry when trusted depth is 0', async () => {
    process.env['TRUSTED_PROXY_DEPTH'] = '0';
    const { extractClientIp } = await import('../../src/shared/extract-client-ip.js');
    const ip = extractClientIp({
      sourceIp: '10.0.0.1',
      headers: { 'x-forwarded-for': '5.6.7.8' },
    });
    expect(ip).toBe('5.6.7.8');
  });

  it('returns the client IP from XFF when trusted depth is 1', async () => {
    process.env['TRUSTED_PROXY_DEPTH'] = '1';
    const { extractClientIp } = await import('../../src/shared/extract-client-ip.js');
    const ip = extractClientIp({
      sourceIp: '10.0.0.2',
      headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1' },
    });
    expect(ip).toBe('5.6.7.8');
  });

  it('returns the client IP from XFF when trusted depth is 2', async () => {
    process.env['TRUSTED_PROXY_DEPTH'] = '2';
    const { extractClientIp } = await import('../../src/shared/extract-client-ip.js');
    const ip = extractClientIp({
      sourceIp: '10.0.0.3',
      headers: { 'x-forwarded-for': '5.6.7.8, 10.0.0.1, 10.0.0.2' },
    });
    expect(ip).toBe('5.6.7.8');
  });

  it('falls back to sourceIp when XFF is empty', async () => {
    process.env['TRUSTED_PROXY_DEPTH'] = '1';
    const { extractClientIp } = await import('../../src/shared/extract-client-ip.js');
    const ip = extractClientIp({
      sourceIp: '1.2.3.4',
      headers: { 'x-forwarded-for': '' },
    });
    expect(ip).toBe('1.2.3.4');
  });
});

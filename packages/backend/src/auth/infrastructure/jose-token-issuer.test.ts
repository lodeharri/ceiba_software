import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { JoseTokenIssuer } from './jose-token-issuer.js';

const SECRET = 'integration-test-secret-at-least-32-bytes-long';

describe('JoseTokenIssuer', () => {
  it('issues an HS256 token that round-trips through jose.jwtVerify with the same claims', async () => {
    process.env['JWT_SECRET'] = SECRET;
    const issuer = new JoseTokenIssuer(SECRET);
    const issued = await issuer.issue(
      { sub: '11111111-1111-4111-8111-111111111111', username: 'admin', role: 'admin' },
      60,
    );
    expect(issued.token.split('.')).toHaveLength(3);
    expect(issued.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const secret = new TextEncoder().encode(SECRET);
    const { payload } = await jwtVerify(issued.token, secret, {
      algorithms: ['HS256'],
      issuer: 'mercadoexpress',
      audience: 'mercadoexpress-api',
    });
    expect(payload['sub']).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload['username']).toBe('admin');
    expect(payload['role']).toBe('admin');
    expect(payload['iss']).toBe('mercadoexpress');
    expect(payload['aud']).toBe('mercadoexpress-api');
  });

  it('rejects an expired token on verify', async () => {
    const issuer = new JoseTokenIssuer(SECRET);
    const issued = await issuer.issue(
      { sub: '11111111-1111-4111-8111-111111111111', username: 'admin', role: 'admin' },
      // Negative delta guarantees exp is already in the past.
      -10,
    );
    const secret = new TextEncoder().encode(SECRET);
    await expect(jwtVerify(issued.token, secret, { algorithms: ['HS256'] })).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const issuer = new JoseTokenIssuer(SECRET);
    const issued = await issuer.issue(
      { sub: '11111111-1111-4111-8111-111111111111', username: 'admin', role: 'admin' },
      60,
    );
    const wrongSecret = new TextEncoder().encode('wrong-secret-but-also-long-enough');
    await expect(jwtVerify(issued.token, wrongSecret, { algorithms: ['HS256'] })).rejects.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { BcryptPasswordHasher } from './bcrypt-password-hasher.js';

describe('BcryptPasswordHasher', () => {
  it('hashes a plain password at the default cost (10) and verifies the same password', async () => {
    const hasher = new BcryptPasswordHasher();
    const hash = await hasher.hash('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await hasher.compare('correct-horse-battery-staple', hash)).toBe(true);
    expect(await hasher.compare('wrong', hash)).toBe(false);
  });

  it('respects an explicit cost override and produces hashes for both', async () => {
    const cost10 = new BcryptPasswordHasher(10);
    const cost12 = new BcryptPasswordHasher(12);
    const h10 = await cost10.hash('abc12345');
    const h12 = await cost12.hash('abc12345');
    expect(h10).toMatch(/^\$2[aby]\$10\$/);
    expect(h12).toMatch(/^\$2[aby]\$12\$/);
    // Cross-cost compare is still correct because bcrypt extracts the cost
    // from the stored hash.
    expect(await cost10.compare('abc12345', h10)).toBe(true);
    expect(await cost10.compare('abc12345', h12)).toBe(true);
  });

  it('produces hashes that the raw bcrypt module accepts', async () => {
    const hasher = new BcryptPasswordHasher();
    const hash = await hasher.hash('hello-world');
    expect(await bcrypt.compare('hello-world', hash)).toBe(true);
  });
});

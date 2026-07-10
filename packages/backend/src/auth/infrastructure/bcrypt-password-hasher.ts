/**
 * Auth BC — BcryptPasswordHasher (PR 2a, D6 — bcrypt cost 10).
 *
 * Default cost is `BCRYPT_COST` env var (10) — the seed CustomResource
 * and the login Lambda agree on the same env so a hash produced by
 * one verifies in the other.
 */

import bcrypt from 'bcrypt';
import type { PasswordHasher } from '../domain/ports/password-hasher.js';

export class BcryptPasswordHasher implements PasswordHasher {
  private readonly cost: number;

  constructor(cost?: number) {
    const fromEnv = process.env['BCRYPT_COST'];
    this.cost = cost ?? (fromEnv ? Number(fromEnv) : 10);
    if (!Number.isFinite(this.cost) || this.cost < 4 || this.cost > 15) {
      throw new Error(`Invalid BCRYPT_COST: ${this.cost}`);
    }
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

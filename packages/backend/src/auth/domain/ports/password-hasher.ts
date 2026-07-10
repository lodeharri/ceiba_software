/**
 * Auth BC — PasswordHasher port (PR 2a, D6 — bcrypt cost 10).
 */

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

import { describe, expect, it } from 'vitest';
import { User } from './user.js';

const BASE_BCRYPT_HASH_10 = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0';
const BASE_BCRYPT_HASH_11 = '$2b$11$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0';

describe('User.create (auth BC — domain)', () => {
  it('creates a valid user with expected accessors', () => {
    const user = User.create({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'Admin@MercadoExpress.Local',
      username: 'Admin',
      passwordHash: BASE_BCRYPT_HASH_10,
    });

    expect(user.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(user.email).toBe('admin@mercadoexpress.local'); // normalized lower-case
    expect(user.username).toBe('admin'); // normalized lower-case
    expect(user.role).toBe('admin');
    expect(user.passwordHash).toBe(BASE_BCRYPT_HASH_10);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid email', () => {
    expect(() =>
      User.create({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'not-an-email',
        username: 'admin',
        passwordHash: BASE_BCRYPT_HASH_10,
      }),
    ).toThrow(/User\.email/);
  });

  it('rejects a too-short username (<3 chars)', () => {
    expect(() =>
      User.create({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@mercadoexpress.local',
        username: 'ab',
        passwordHash: BASE_BCRYPT_HASH_10,
      }),
    ).toThrow(/User\.username/);
  });

  it('rejects a username outside the character set', () => {
    expect(() =>
      User.create({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@mercadoexpress.local',
        username: 'admin user', // spaces forbidden
        passwordHash: BASE_BCRYPT_HASH_10,
      }),
    ).toThrow(/User\.username/);
  });

  it('rejects a password hash whose bcrypt cost differs from BCRYPT_COST env', () => {
    expect(() =>
      User.create({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'admin@mercadoexpress.local',
        username: 'admin',
        passwordHash: BASE_BCRYPT_HASH_11, // cost 11 vs BCRYPT_COST=10
      }),
    ).toThrow(/bcrypt cost/);
  });

  it('accepts a well-formed hash at the configured cost', () => {
    const user = User.create({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@mercadoexpress.local',
      username: 'admin',
      passwordHash: BASE_BCRYPT_HASH_10,
    });
    expect(user.role).toBe('admin');
  });
});

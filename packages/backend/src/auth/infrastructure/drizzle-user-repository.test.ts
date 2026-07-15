import { describe, expect, it } from 'vitest';
import { DrizzleUserRepository } from './drizzle-user-repository.js';

describe('DrizzleUserRepository', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@mercadoexpress.local',
    username: 'admin',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJK1234',
    role: 'admin' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  function makeFakeDb(seed: (typeof row)[], queryPattern: string) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              if (queryPattern.includes('username')) {
                return Promise.resolve(seed.filter((r) => r.username === 'admin'));
              }
              if (queryPattern.includes('id')) {
                return Promise.resolve(
                  seed.filter((r) => r.id === '99999999-9999-4999-8999-999999999999'),
                );
              }
              if (queryPattern.includes('email')) {
                return Promise.resolve([]);
              }
              return Promise.resolve([]);
            },
          }),
        }),
      }),
    };
  }

  it('findByUsername returns the row when present', async () => {
    const db = makeFakeDb([row], 'username');
    // @ts-expect-error test doubles the real db interface
    const repo = new DrizzleUserRepository(db);
    const user = await repo.findByUsername('admin');
    expect(user).not.toBeNull();
    expect(user!.id).toBe(row.id);
  });

  it('findByUsername normalizes input to lower-case', async () => {
    const db = makeFakeDb([row], 'username');
    // @ts-expect-error test doubles the real db interface
    const repo = new DrizzleUserRepository(db);
    const user = await repo.findByUsername('Admin');
    expect(user).not.toBeNull();
  });

  it('findById returns null for an unknown id', async () => {
    const db = makeFakeDb([row], 'id');
    // @ts-expect-error test doubles the real db interface
    const repo = new DrizzleUserRepository(db);
    expect(await repo.findById('99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('findByEmail returns null when the email is absent', async () => {
    const db = makeFakeDb([row], 'email');
    // @ts-expect-error test doubles the real db interface
    const repo = new DrizzleUserRepository(db);
    expect(await repo.findByEmail('ghost@mercadoexpress.local')).toBeNull();
  });
});

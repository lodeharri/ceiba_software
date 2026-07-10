import { describe, expect, it } from 'vitest';
import { PrismaUserRepository, type UserPrisma } from './prisma-user-repository.js';

function makeFakePrisma(
  seed: Array<{
    id: string;
    email: string;
    username: string;
    passwordHash: string;
    role: 'admin';
    createdAt: Date;
  }>,
) {
  return {
    prisma: {
      user: {
        async findUnique(args: { where: { username?: string; id?: string; email?: string } }) {
          const key = Object.keys(args.where)[0] as 'username' | 'id' | 'email';
          const value = args.where[key]!;
          return seed.find((s) => s[key] === value) ?? null;
        },
      },
    } as unknown as UserPrisma,
  };
}

describe('PrismaUserRepository', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@mercadoexpress.local',
    username: 'admin',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJK1234',
    role: 'admin' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('findByUsername returns the row when present', async () => {
    const { prisma } = makeFakePrisma([row]);
    const repo = new PrismaUserRepository(prisma);
    const user = await repo.findByUsername('admin');
    expect(user).not.toBeNull();
    expect(user!.id).toBe(row.id);
  });

  it('findByUsername normalizes input to lower-case', async () => {
    const { prisma } = makeFakePrisma([row]);
    const repo = new PrismaUserRepository(prisma);
    const user = await repo.findByUsername('Admin');
    expect(user).not.toBeNull();
  });

  it('findById returns null for an unknown id', async () => {
    const { prisma } = makeFakePrisma([row]);
    const repo = new PrismaUserRepository(prisma);
    expect(await repo.findById('99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('findByEmail returns null when the email is absent', async () => {
    const { prisma } = makeFakePrisma([row]);
    const repo = new PrismaUserRepository(prisma);
    expect(await repo.findByEmail('ghost@mercadoexpress.local')).toBeNull();
  });
});

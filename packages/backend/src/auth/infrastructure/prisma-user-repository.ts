/**
 * Auth BC — PrismaUserRepository (PR 2a).
 *
 * Adapter implementing `UserRepository` against `@prisma/client`.
 * Uses a typed subset of the Prisma surface so the production build
 * works once `prisma generate` runs in the migrations Lambda.
 *
 * In tests the `PrismaLike` interface is satisfied by a hand-rolled
 * stub (see `domain/user.test.ts` for the auth-side test path).
 */

import type { UserRepository } from '../domain/ports/user-repository.js';
import type { UserProps } from '../domain/user.js';

/** Minimal Prisma surface the user repository needs. */
export interface UserPrisma {
  user: {
    findUnique(args: {
      where: { username?: string; id?: string; email?: string };
    }): Promise<(Omit<UserProps, 'createdAt'> & { createdAt: Date }) | null>;
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: UserPrisma) {}

  findByUsername(username: string): Promise<UserProps | null> {
    return this.findByField('username', username.toLowerCase());
  }

  findById(id: string): Promise<UserProps | null> {
    return this.findByField('id', id);
  }

  findByEmail(email: string): Promise<UserProps | null> {
    return this.findByField('email', email.toLowerCase());
  }

  private async findByField(
    field: 'username' | 'id' | 'email',
    value: string,
  ): Promise<UserProps | null> {
    const row = await this.prisma.user.findUnique({ where: { [field]: value } });
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role,
      createdAt: row.createdAt,
    };
  }
}

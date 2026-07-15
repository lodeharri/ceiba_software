/**
 * Auth BC — DrizzleUserRepository (PR 1.2).
 *
 * Adapter implementing `UserRepository` against Drizzle ORM.
 * Replaces `PrismaUserRepository` for the Prisma → Drizzle migration.
 */

import { eq } from 'drizzle-orm';
import type { UserRepository } from '../domain/ports/user-repository.js';
import type { UserProps } from '../domain/user.js';
import * as schema from '../../db/schema.js';
import { getDb } from '../../shared/db.js';

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db = getDb()) {}

  async findByUsername(username: string): Promise<UserProps | null> {
    return this.findByField('username', username.toLowerCase());
  }

  async findById(id: string): Promise<UserProps | null> {
    return this.findByField('id', id);
  }

  async findByEmail(email: string): Promise<UserProps | null> {
    return this.findByField('email', email.toLowerCase());
  }

  private async findByField(
    field: 'username' | 'id' | 'email',
    value: string,
  ): Promise<UserProps | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users[field], value))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.passwordHash,
      role: row.role as UserProps['role'],
      createdAt: row.createdAt,
    };
  }
}

/**
 * Auth BC — UserRepository port (PR 2a).
 *
 * Persistence interface owned by the domain layer. The concrete
 * Prisma adapter (`infrastructure/prisma-user-repository.ts`)
 * implements this; the use case (`application/login.ts`) only
 * depends on the port.
 */

import type { UserProps } from '../user.js';

export interface UserRepository {
  findByUsername(username: string): Promise<UserProps | null>;
  findById(id: string): Promise<UserProps | null>;
  findByEmail(email: string): Promise<UserProps | null>;
}

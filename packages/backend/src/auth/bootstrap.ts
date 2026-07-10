/**
 * Auth BC bootstrap (PR 2a).
 *
 * Wires all adapters into the application layer:
 *   - BcryptPasswordHasher        (bcrypt cost = BCRYPT_COST env, default 10)
 *   - JoseTokenIssuer             (HS256 from JWT_SECRET env, SSM-backed)
 *   - PrismaUserRepository        (@prisma/client.user.findUnique)
 *   - PostgresRateLimiter         (login_attempts table, RISK-003)
 *   - LoginUseCase                with DEFAULT_LOGIN_CONFIG
 *
 * The handler is read via `getAuthBootstrap()`; the singleton is
 * process-global so a warm Lambda keeps the same PrismaClient across
 * invocations (RISK-W11 connection_limit = 2).
 */

import { getPrismaClient, type PrismaLike } from '../shared/prisma-client.js';
import { LoginUseCase } from './application/login.js';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher.js';
import { JoseTokenIssuer } from './infrastructure/jose-token-issuer.js';
import { PostgresRateLimiter } from './infrastructure/postgres-rate-limiter.js';
import { PrismaUserRepository } from './infrastructure/prisma-user-repository.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface AuthBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
  loginUseCase: LoginUseCase;
}

interface GlobalWithAuth {
  __mercadoExpressAuth?: AuthBootstrap;
}

export function bootstrapAuth(prismaOverride?: PrismaLike): AuthBootstrap {
  const g = globalThis as GlobalWithAuth;
  if (g.__mercadoExpressAuth) {
    return g.__mercadoExpressAuth;
  }
  // The prisma client is structurally compatible with both adapters'
  // minimal PrismaLike signatures; `unknown` keeps tsc happy without
  // doing structural compat gymnastics over the union.
  const prisma = (prismaOverride ?? getPrismaClient()) as unknown as ConstructorParameters<
    typeof PrismaUserRepository
  >[0] &
    ConstructorParameters<typeof PostgresRateLimiter>[0];
  const users = new PrismaUserRepository(prisma);
  const hasher = new BcryptPasswordHasher();
  const issuer = new JoseTokenIssuer();
  const rateLimiter = new PostgresRateLimiter(prisma);
  const loginUseCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
  const bootstrap: AuthBootstrap = {
    prisma: prismaOverride ?? getPrismaClient(),
    logger: createLogger().child({ bc: 'auth' }),
    loginUseCase,
  };
  g.__mercadoExpressAuth = bootstrap;
  return bootstrap;
}

export function getAuthBootstrap(): AuthBootstrap {
  return bootstrapAuth();
}

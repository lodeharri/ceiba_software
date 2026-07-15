/**
 * Auth BC bootstrap (PR 1.2).
 *
 * Wires all adapters into the application layer:
 *   - BcryptPasswordHasher        (bcrypt cost = BCRYPT_COST env, default 10)
 *   - JoseTokenIssuer             (HS256 from JWT_SECRET env, SSM-backed)
 *   - DrizzleUserRepository       (drizzle-orm users table)
 *   - DrizzleRateLimiter          (login_attempts table, RISK-003)
 *   - LoginUseCase                with DEFAULT_LOGIN_CONFIG
 *
 * The handler is read via `getAuthBootstrap()`; the singleton is
 * process-global so a warm Lambda keeps the same Drizzle client across
 * invocations (RISK-W11 connection_limit = 2).
 */

import { getDb, type Db } from '../shared/db.js';
import { LoginUseCase } from './application/login.js';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher.js';
import { JoseTokenIssuer } from './infrastructure/jose-token-issuer.js';
import { DrizzleRateLimiter } from './infrastructure/drizzle-rate-limiter.js';
import { DrizzleUserRepository } from './infrastructure/drizzle-user-repository.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';

export interface AuthBootstrap {
  db: Db;
  logger: PinoLogger;
  loginUseCase: LoginUseCase;
}

interface GlobalWithAuth {
  __mercadoExpressAuth?: AuthBootstrap;
}

export function bootstrapAuth(dbOverride?: Db): AuthBootstrap {
  const g = globalThis as GlobalWithAuth;
  if (g.__mercadoExpressAuth) {
    return g.__mercadoExpressAuth;
  }
  const db = dbOverride ?? getDb();
  const users = new DrizzleUserRepository(db);
  const hasher = new BcryptPasswordHasher();
  const issuer = new JoseTokenIssuer();
  const rateLimiter = new DrizzleRateLimiter(db);
  const loginUseCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
  const bootstrap: AuthBootstrap = {
    db,
    logger: createLogger().child({ bc: 'auth' }),
    loginUseCase,
  };
  g.__mercadoExpressAuth = bootstrap;
  return bootstrap;
}

export function getAuthBootstrap(): AuthBootstrap {
  return bootstrapAuth();
}

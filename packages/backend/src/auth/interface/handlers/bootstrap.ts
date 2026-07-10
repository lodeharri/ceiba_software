/**
 * Auth BC bootstrap (PR 1).
 *
 * Wires the dependencies for the auth BC: prisma client, pino logger,
 * and a placeholder router. PR 2a replaces the placeholder router
 * with the real login + refresh-token use cases.
 */

import { getPrismaClient } from '../../../shared/prisma-client.js';
import { createLogger } from '../../../shared/logger.js';
import type { PrismaLike } from '../../../shared/prisma-client.js';
import type { Logger as PinoLogger } from 'pino';

export interface AuthBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
}

export function bootstrapAuth(): AuthBootstrap {
  return {
    prisma: getPrismaClient(),
    logger: createLogger().child({ bc: 'auth' }),
  };
}

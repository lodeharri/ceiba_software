/**
 * Products BC bootstrap (PR 1).
 */

import { getPrismaClient } from '../../../shared/prisma-client.js';
import { createLogger } from '../../../shared/logger.js';
import type { PrismaLike } from '../../../shared/prisma-client.js';
import type { Logger as PinoLogger } from 'pino';

export interface ProductsBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
}

export function bootstrapProducts(): ProductsBootstrap {
  return {
    prisma: getPrismaClient(),
    logger: createLogger().child({ bc: 'products' }),
  };
}

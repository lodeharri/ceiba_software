/**
 * Orders BC bootstrap (PR 1).
 */

import { getPrismaClient } from '../../../shared/prisma-client.js';
import { createLogger } from '../../../shared/logger.js';
import type { PrismaLike } from '../../../shared/prisma-client.js';
import type { Logger as PinoLogger } from 'pino';

export interface OrdersBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
}

export function bootstrapOrders(): OrdersBootstrap {
  return {
    prisma: getPrismaClient(),
    logger: createLogger().child({ bc: 'orders' }),
  };
}

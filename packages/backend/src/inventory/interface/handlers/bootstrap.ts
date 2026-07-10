/**
 * Inventory BC bootstrap (PR 1).
 */

import { getPrismaClient } from '../../../shared/prisma-client.js';
import { createLogger } from '../../../shared/logger.js';
import type { PrismaLike } from '../../../shared/prisma-client.js';
import type { Logger as PinoLogger } from 'pino';

export interface InventoryBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
}

export function bootstrapInventory(): InventoryBootstrap {
  return {
    prisma: getPrismaClient(),
    logger: createLogger().child({ bc: 'inventory' }),
  };
}

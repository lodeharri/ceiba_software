/**
 * Inventory BC bootstrap (PR 2b).
 *
 * Wires the application service and infrastructure adapters for the
 * inventory Lambda.
 *
 * ## Dependency injection
 *
 * `StockMutationService` depends on `AlertCloserPort`, which is owned by
 * the `alerts` BC. The adapter for this port (`PrismaAlertCloserPort`)
 * is created in Work Unit 3; until then the bootstrap uses a no-op stub
 * that logs an info message. Production deployments MUST provide a real
 * implementation via the `alertCloser` override.
 *
 * ## Singleton accessor
 *
 * Handlers import `getInventoryBootstrap()` (rather than calling
 * `bootstrapInventory()` themselves) so the bootstrap is initialised
 * exactly once per Lambda execution.
 */

import { getPrismaClient } from '../shared/prisma-client.js';
import { createLogger } from '../shared/logger.js';
import type { PrismaLike } from '../shared/prisma-client.js';
import type { Logger as PinoLogger } from 'pino';
import type { AlertCloserPort } from '../alerts/domain/ports/alert-closer-port.js';
import { StockMutationService } from './application/stock-mutation-service.js';
import {
  PrismaStockMovementRepository,
  type StockMovementPrisma,
} from './infrastructure/prisma-stock-movement-repository.js';

export interface InventoryBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
  stockMutationService: StockMutationService;
  stockMovementRepository: PrismaStockMovementRepository;
}

// ── Default no-op AlertCloserPort (replaced by Work Unit 3) ──

const noopAlertCloser: AlertCloserPort = {
  async txCloseIfOpenAndAboveMin() {
    return null;
  },
};

// ── Singleton ──

let _instance: InventoryBootstrap | null = null;

/**
 * Initialises the inventory bootstrap.
 *
 * @param alertCloser  Optional AlertCloserPort implementation.
 *                     Defaults to a no-op stub until the alerts BC
 *                     adapter is wired in Work Unit 3.
 */
export function bootstrapInventory(alertCloser?: AlertCloserPort): InventoryBootstrap {
  const prisma = getPrismaClient();
  const logger = createLogger().child({ bc: 'inventory' });
  const stockMovementRepository = new PrismaStockMovementRepository(
    prisma as unknown as StockMovementPrisma,
  );
  const stockMutationService = new StockMutationService(prisma, alertCloser ?? noopAlertCloser);

  const instance: InventoryBootstrap = {
    prisma,
    logger,
    stockMutationService,
    stockMovementRepository,
  };

  _instance = instance;
  return instance;
}

/**
 * Returns the singleton bootstrap instance. Throws if not yet initialised.
 *
 * Routes that need bootstrap dependencies call this; the Lambda entry
 * point should call `bootstrapInventory()` before any handler runs.
 */
export function getInventoryBootstrap(): InventoryBootstrap {
  if (!_instance) {
    throw new Error(
      'InventoryBootstrap not initialised. Call bootstrapInventory() before handling requests.',
    );
  }
  return _instance;
}

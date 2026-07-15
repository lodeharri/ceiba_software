/**
 * Inventory BC bootstrap (PR 1.2).
 *
 * Wires the application service and infrastructure adapters for the
 * inventory Lambda.
 */

import type { Pool } from 'pg';
import { getPool, getDb } from '../shared/db.js';
import { DrizzleUnitOfWork } from '../shared/infrastructure/drizzle-unit-of-work.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import type { AlertCloserPort } from '../alerts/domain/ports/alert-closer-port.js';
import { StockMutationService } from './application/stock-mutation-service.js';
import { DrizzleStockMovementRepository } from './infrastructure/drizzle-stock-movement-repository.js';
import type { UnitOfWork } from '../shared/domain/ports/unit-of-work.js';

export interface InventoryBootstrap {
  pool: Pool;
  uow: UnitOfWork;
  logger: PinoLogger;
  stockMutationService: StockMutationService;
  stockMovementRepository: DrizzleStockMovementRepository;
}

// ── Default no-op AlertCloserPort (replaced by Work Unit 3) ──

const noopAlertCloser: AlertCloserPort = {
  async txCloseIfOpenAndAboveMin() {
    return null;
  },
};

// ── Singleton via globalThis (same pattern as alerts BC) ──

interface GlobalWithInventory {
  __mercadoExpressInventory?: InventoryBootstrap;
}

/**
 * Initialises the inventory bootstrap.
 *
 * @param alertCloser  Optional AlertCloserPort implementation.
 *                     Defaults to a no-op stub until the alerts BC
 *                     adapter is wired in Work Unit 3.
 */
export function bootstrapInventory(alertCloser?: AlertCloserPort): InventoryBootstrap {
  const g = globalThis as GlobalWithInventory;
  if (g.__mercadoExpressInventory) {
    return g.__mercadoExpressInventory;
  }

  const pool = getPool();
  const db = getDb();
  const uow = new DrizzleUnitOfWork(pool);
  const logger = createLogger().child({ bc: 'inventory' });
  const stockMovementRepository = new DrizzleStockMovementRepository(db);
  const stockMutationService = new StockMutationService(uow, alertCloser ?? noopAlertCloser);

  const instance: InventoryBootstrap = {
    pool,
    uow,
    logger,
    stockMutationService,
    stockMovementRepository,
  };

  g.__mercadoExpressInventory = instance;
  return instance;
}

/**
 * Returns the singleton bootstrap instance, auto-initialising if needed.
 * Handlers import this — no separate bootstrap call required.
 */
export function getInventoryBootstrap(): InventoryBootstrap {
  return bootstrapInventory();
}

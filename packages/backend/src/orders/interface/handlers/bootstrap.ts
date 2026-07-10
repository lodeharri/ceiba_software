/**
 * Orders BC bootstrap (PR 2c).
 *
 * Wires all orders use cases and infrastructure adapters for the orders Lambda.
 *
 * ## Dependency injection
 *
 * ReceiveOrderUseCase consumes three ports:
 *   - OrderRepository (this BC) → PrismaOrderRepository
 *   - ProductStockGate (inventory BC) → PrismaProductStockGate
 *   - AlertCloserPort (alerts BC) → PrismaAlertCloserPort
 *
 * CreateOrderUseCase consumes:
 *   - ProductReadRepository → PrismaProductReadRepository
 *   - AlertReadRepository → PrismaAlertReadRepository
 */

import { getPrismaClient } from '../../../shared/prisma-client.js';
import { createLogger } from '../../../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import { CreateOrderUseCase } from '../../application/create-order.js';
import { ApproveOrderUseCase } from '../../application/approve-order.js';
import { RejectOrderUseCase } from '../../application/reject-order.js';
import { ReceiveOrderUseCase } from '../../application/receive-order.js';
import { ListOrdersUseCase } from '../../application/list-orders.js';
import { GetOrderUseCase } from '../../application/get-order.js';

import {
  PrismaOrderRepository,
  type OrderPrisma,
} from '../../infrastructure/prisma-order-repository.js';
import {
  PrismaProductReadRepository,
  type ProductPrisma,
} from '../../infrastructure/prisma-product-read-repository.js';
import {
  PrismaAlertReadRepository,
  type AlertPrisma,
} from '../../infrastructure/prisma-alert-read-repository.js';
import { PrismaProductStockGate } from '../../../inventory/infrastructure/prisma-product-stock-gate.js';
import { PrismaAlertCloserPort } from '../../../alerts/infrastructure/prisma-alert-closer-port.js';

export interface OrdersBootstrap {
  logger: PinoLogger;
  createOrderUseCase: CreateOrderUseCase;
  approveOrderUseCase: ApproveOrderUseCase;
  rejectOrderUseCase: RejectOrderUseCase;
  receiveOrderUseCase: ReceiveOrderUseCase;
  listOrdersUseCase: ListOrdersUseCase;
  getOrderUseCase: GetOrderUseCase;
}

// Singleton via globalThis
interface GlobalWithOrders {
  __mercadoExpressOrders?: OrdersBootstrap;
}

export function bootstrapOrders(): OrdersBootstrap {
  const g = globalThis as GlobalWithOrders;
  if (g.__mercadoExpressOrders) return g.__mercadoExpressOrders;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;

  const orderRepo = new PrismaOrderRepository(prisma as OrderPrisma);
  const productReadRepo = new PrismaProductReadRepository(prisma as ProductPrisma);
  const alertReadRepo = new PrismaAlertReadRepository(prisma as AlertPrisma);
  const stockGate = new PrismaProductStockGate();
  const alertCloser = new PrismaAlertCloserPort();

  const logger = createLogger().child({ bc: 'orders' });

  const instance: OrdersBootstrap = {
    logger,
    createOrderUseCase: new CreateOrderUseCase(orderRepo, productReadRepo, alertReadRepo),
    approveOrderUseCase: new ApproveOrderUseCase(orderRepo),
    rejectOrderUseCase: new RejectOrderUseCase(orderRepo),
    receiveOrderUseCase: new ReceiveOrderUseCase(prisma, orderRepo, stockGate, alertCloser),
    listOrdersUseCase: new ListOrdersUseCase(orderRepo),
    getOrderUseCase: new GetOrderUseCase(orderRepo),
  };

  g.__mercadoExpressOrders = instance;
  return instance;
}

export function getOrdersBootstrap(): OrdersBootstrap {
  return bootstrapOrders();
}

/**
 * Test-only: mock factory for co-located test files.
 * Pattern matches inventory/bootstrap.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mockCreateOrderExecute: any;
export function _resetMockCreateOrder() {
  _mockCreateOrderExecute = undefined;
}
export function _getMockCreateOrder() {
  return _mockCreateOrderExecute;
}

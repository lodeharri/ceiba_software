/**
 * Orders BC bootstrap (PR 1.2).
 *
 * Wires all orders use cases and infrastructure adapters for the orders Lambda.
 *
 * ## Dependency injection
 *
 * ReceiveOrderUseCase consumes four ports:
 *   - OrderRepository (this BC) → DrizzleOrderRepository
 *   - ProductReadRepository (products BC) → DrizzleProductReadRepository
 *   - ProductStockGate (inventory BC) → DrizzleProductStockGate
 *   - AlertCloserPort (alerts BC) → DrizzleAlertCloserPort
 *   - UnitOfWork → DrizzleUnitOfWork (wraps atomic transaction)
 *
 * CreateOrderUseCase consumes:
 *   - OrderRepository (this BC) → DrizzleOrderRepository
 *   - ProductReadRepository (products BC) → DrizzleProductReadRepository
 *   - AlertReadRepository (alerts BC) → DrizzleAlertReadRepository
 *
 * ApproveOrderUseCase / RejectOrderUseCase consume:
 *   - OrderRepository
 *   - ProductReadRepository (for the composed read-model response)
 *
 * ListOrdersUseCase / GetOrderUseCase consume:
 *   - OrderRepository
 *   - ProductReadRepository (for the composed read-model response)
 */

import { getPool, getDb } from '../../../shared/db.js';
import { DrizzleUnitOfWork } from '../../../shared/infrastructure/drizzle-unit-of-work.js';
import { createLogger } from '../../../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import { CreateOrderUseCase } from '../../application/create-order.js';
import { ApproveOrderUseCase } from '../../application/approve-order.js';
import { RejectOrderUseCase } from '../../application/reject-order.js';
import { ReceiveOrderUseCase } from '../../application/receive-order.js';
import { ListOrdersUseCase } from '../../application/list-orders.js';
import { GetOrderUseCase } from '../../application/get-order.js';

import { DrizzleOrderRepository } from '../../infrastructure/drizzle-order-repository.js';
import { DrizzleProductReadRepository } from '../../infrastructure/drizzle-product-read-repository.js';
import { DrizzleAlertReadRepository } from '../../infrastructure/drizzle-alert-read-repository.js';
import { DrizzleProductStockGate } from '../../../inventory/infrastructure/drizzle-product-stock-gate.js';
import { DrizzleAlertCloserPort } from '../../../alerts/infrastructure/drizzle-alert-closer-port.js';
import type { UnitOfWork } from '../../../shared/domain/ports/unit-of-work.js';

export interface OrdersBootstrap {
  uow: UnitOfWork;
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

  const pool = getPool();
  const db = getDb();
  const uow = new DrizzleUnitOfWork(pool);

  const orderRepo = new DrizzleOrderRepository(db);
  const productReadRepo = new DrizzleProductReadRepository(db);
  const alertReadRepo = new DrizzleAlertReadRepository(db);
  const stockGate = new DrizzleProductStockGate();
  const alertCloser = new DrizzleAlertCloserPort();

  const logger = createLogger().child({ bc: 'orders' });

  const instance: OrdersBootstrap = {
    uow,
    logger,
    createOrderUseCase: new CreateOrderUseCase(orderRepo, productReadRepo, alertReadRepo),
    approveOrderUseCase: new ApproveOrderUseCase(orderRepo, productReadRepo),
    rejectOrderUseCase: new RejectOrderUseCase(orderRepo, productReadRepo),
    receiveOrderUseCase: new ReceiveOrderUseCase(
      uow,
      orderRepo,
      productReadRepo,
      stockGate,
      alertCloser,
    ),
    listOrdersUseCase: new ListOrdersUseCase(orderRepo, productReadRepo),
    getOrderUseCase: new GetOrderUseCase(orderRepo, productReadRepo),
  };

  g.__mercadoExpressOrders = instance;
  return instance;
}

export function getOrdersBootstrap(): OrdersBootstrap {
  return bootstrapOrders();
}

/**
 * Test-only: mock factory for co-located test files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mockCreateOrderExecute: any;
export function _resetMockCreateOrder() {
  _mockCreateOrderExecute = undefined;
}
export function _getMockCreateOrder() {
  return _mockCreateOrderExecute;
}

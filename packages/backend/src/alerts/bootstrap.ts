/**
 * Alerts BC bootstrap (PR 2b).
 *
 * Wires all adapters into the application layer for the alerts Lambda.
 * This is the BC-level bootstrap — handlers import `getAlertsBootstrap()`
 * from here to get wired use cases.
 */

import { getPrismaClient, type PrismaLike } from '../shared/prisma-client.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import { ListAlerts } from './application/list-alerts.js';
import { GetAlert } from './application/get-alert.js';
import { PrismaAlertCloserPort } from './infrastructure/prisma-alert-closer-port.js';
import {
  PrismaAlertRepository,
  type AlertPrisma,
} from './infrastructure/prisma-alert-repository.js';
import {
  PrismaProductReadPort,
  type ProductReadPrisma,
} from './infrastructure/prisma-product-read-port.js';
import type { AlertCloserPort } from './domain/ports/alert-closer-port.js';

export interface AlertsBootstrap {
  prisma: PrismaLike;
  logger: PinoLogger;
  getAlert: GetAlert;
  listAlerts: ListAlerts;
  alertCloserPort: AlertCloserPort;
  alertRepository: PrismaAlertRepository;
  productReadPort: PrismaProductReadPort;
}

interface GlobalWithAlerts {
  __mercadoExpressAlerts?: AlertsBootstrap;
}

export function bootstrapAlerts(prismaOverride?: PrismaLike): AlertsBootstrap {
  const g = globalThis as GlobalWithAlerts;
  if (g.__mercadoExpressAlerts) {
    return g.__mercadoExpressAlerts;
  }

  const prisma = (prismaOverride ?? getPrismaClient()) as unknown as AlertPrisma &
    ProductReadPrisma &
    PrismaLike;

  const alertCloserPort = new PrismaAlertCloserPort();
  const alertRepository = new PrismaAlertRepository(prisma);
  const productReadPort = new PrismaProductReadPort(prisma);

  const getAlert = new GetAlert(alertRepository, productReadPort);
  const listAlerts = new ListAlerts(alertRepository, productReadPort);

  const bootstrap: AlertsBootstrap = {
    prisma: prismaOverride ?? getPrismaClient(),
    logger: createLogger().child({ bc: 'alerts' }),
    getAlert,
    listAlerts,
    alertCloserPort,
    alertRepository,
    productReadPort,
  };

  g.__mercadoExpressAlerts = bootstrap;
  return bootstrap;
}

export function getAlertsBootstrap(): AlertsBootstrap {
  return bootstrapAlerts();
}

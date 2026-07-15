/**
 * Alerts BC bootstrap (PR 1.2).
 *
 * Wires all adapters into the application layer for the alerts Lambda.
 * This is the BC-level bootstrap — handlers import `getAlertsBootstrap()`
 * from here to get wired use cases.
 */

import { getDb, type Db } from '../shared/db.js';
import { createLogger } from '../shared/logger.js';
import type { Logger as PinoLogger } from 'pino';
import { ListAlerts } from './application/list-alerts.js';
import { GetAlert } from './application/get-alert.js';
import { DrizzleAlertCloserPort } from './infrastructure/drizzle-alert-closer-port.js';
import { DrizzleAlertRepository } from './infrastructure/drizzle-alert-repository.js';
import { DrizzleProductReadPort } from './infrastructure/drizzle-product-read-port.js';
import type { AlertCloserPort } from './domain/ports/alert-closer-port.js';

export interface AlertsBootstrap {
  db: Db;
  logger: PinoLogger;
  getAlert: GetAlert;
  listAlerts: ListAlerts;
  alertCloserPort: AlertCloserPort;
  alertRepository: DrizzleAlertRepository;
  productReadPort: DrizzleProductReadPort;
}

interface GlobalWithAlerts {
  __mercadoExpressAlerts?: AlertsBootstrap;
}

export function bootstrapAlerts(dbOverride?: Db): AlertsBootstrap {
  const g = globalThis as GlobalWithAlerts;
  if (g.__mercadoExpressAlerts) {
    return g.__mercadoExpressAlerts;
  }

  const db = dbOverride ?? getDb();

  const alertCloserPort = new DrizzleAlertCloserPort();
  const alertRepository = new DrizzleAlertRepository(db);
  const productReadPort = new DrizzleProductReadPort(db);

  const getAlert = new GetAlert(alertRepository, productReadPort);
  const listAlerts = new ListAlerts(alertRepository, productReadPort);

  const bootstrap: AlertsBootstrap = {
    db,
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

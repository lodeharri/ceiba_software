/**
 * Alerts BC — GetAlert use case.
 *
 * Fetches a single alert by id, composed via `composeAlert(alert, product)`
 * to match the canonical flat `Alert` read model in `packages/shared` —
 * `productName` / `productSku` / `stockAtOpen` / `stockMin` are required
 * by the schema.
 *
 * If the product has been deleted since the alert opened, throws
 * `AlertProductInconsistencyError` (422) rather than returning a partial
 * shape with undefined productName / productSku. Mirrors `GetOrder` in
 * the orders BC.
 */

import type { AlertRepository } from '../domain/ports/alert-repository.js';
import type { ProductReadPort } from '../domain/ports/product-read-port.js';
import { AlertNotFoundError } from '../domain/errors/alert-not-found.js';
import { AlertProductInconsistencyError } from '../domain/errors/alert-product-inconsistency.js';
import { composeAlert, type AlertReadModel } from './compose-alert.js';

export interface GetAlertInput {
  id: string;
}

export interface GetAlertResult {
  alert: AlertReadModel;
}

export class GetAlert {
  constructor(
    private readonly alertRepo: AlertRepository,
    private readonly productRead: ProductReadPort,
  ) {}

  async execute(input: GetAlertInput): Promise<GetAlertResult> {
    const alert = await this.alertRepo.findById(input.id);
    if (!alert) {
      throw new AlertNotFoundError(input.id);
    }
    const product = await this.productRead.findById(alert.productId);
    if (!product) {
      throw new AlertProductInconsistencyError(alert.id, alert.productId);
    }
    return { alert: composeAlert(alert, product) };
  }
}

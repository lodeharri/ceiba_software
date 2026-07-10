/**
 * Alerts BC — GetAlert use case (PR 2b, alerts/spec.md).
 *
 * Fetches a single alert by ID with product snapshot enrichment.
 */

import type { AlertRepository } from '../domain/ports/alert-repository.js';
import type { ProductReadPort, ProductSnapshot } from '../domain/ports/product-read-port.js';
import type { AlertProps } from '../domain/alert.js';
import { AlertNotFoundError } from '../domain/errors/alert-not-found.js';
import { AlertProductInconsistencyError } from '../domain/errors/alert-product-inconsistency.js';

export interface GetAlertInput {
  id: string;
}

export interface GetAlertResult {
  alert: AlertProps;
  product: ProductSnapshot;
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

    return { alert, product };
  }
}

/**
 * Alerts BC — ListAlerts use case.
 *
 * Lists alerts with optional status filter and pagination.
 *
 * Each row is composed via `composeAlert(alert, product)` so the response
 * matches the canonical flat `Alert` read model in `packages/shared` —
 * `productName` / `productSku` / `stockAtOpen` / `stockMin` are required
 * by the schema, never undefined.
 *
 * Alerts whose product has been deleted since the alert opened are
 * silently dropped (the partial unique constraints in the schema make
 * this race narrow; surfacing a 422 for every dropped row in a list
 * would be hostile UX). This mirrors the orders BC `ListOrdersUseCase`
 * pattern.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../shared/errors/base-domain-error.js';
import type { AlertRepository } from '../domain/ports/alert-repository.js';
import type { ProductReadPort } from '../domain/ports/product-read-port.js';
import { composeAlert, type AlertReadModel } from './compose-alert.js';

const VALID_STATUSES = ['ACTIVA', 'RESUELTA', 'BOTH'] as const;
type InputStatus = (typeof VALID_STATUSES)[number];

export interface ListAlertsInput {
  status?: InputStatus;
  page?: number;
  size?: number;
}

export interface ListAlertsResult {
  items: AlertReadModel[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

class InvalidStatusError extends BaseDomainError {
  constructor(status: string) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      httpStatus: 400,
      message: `Invalid status: '${status}'. Must be one of ACTIVA, RESUELTA, or BOTH.`,
    });
  }
}

export class ListAlerts {
  constructor(
    private readonly alertRepo: AlertRepository,
    private readonly productRead: ProductReadPort,
  ) {}

  async execute(input: ListAlertsInput = {}): Promise<ListAlertsResult> {
    const status = input.status ?? 'BOTH';

    if (!VALID_STATUSES.includes(status)) {
      throw new InvalidStatusError(status);
    }

    const page = Math.max(1, input.page ?? 1);
    const size = input.size ?? 20;

    const repoStatus = status === 'BOTH' ? undefined : status;
    const pageResult = await this.alertRepo.list({
      ...(repoStatus != null && { status: repoStatus }),
      page,
      size,
    });

    // Compose each row. Drop alerts whose product has been deleted.
    const items: AlertReadModel[] = [];
    for (const alert of pageResult.items) {
      const product = await this.productRead.findById(alert.productId);
      if (product) {
        items.push(composeAlert(alert, product));
      }
    }

    return {
      items,
      page: pageResult.page,
      size: pageResult.size,
      total: pageResult.total,
      hasMore: pageResult.hasMore,
    };
  }
}

/**
 * Alerts BC — ListAlerts use case (PR 2b, alerts/spec.md).
 *
 * Lists alerts with optional status filter and pagination.
 * Enriches each alert with a product snapshot via ProductReadPort.
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../shared/errors/base-domain-error.js';
import type { AlertRepository } from '../domain/ports/alert-repository.js';
import type { ProductReadPort, ProductSnapshot } from '../domain/ports/product-read-port.js';
import type { AlertProps } from '../domain/alert.js';

const VALID_STATUSES = ['ACTIVA', 'RESUELTA', 'BOTH'] as const;
type InputStatus = (typeof VALID_STATUSES)[number];

export interface ListAlertsInput {
  status?: InputStatus;
  page?: number;
  size?: number;
}

export interface AlertWithProduct {
  alert: AlertProps;
  product: ProductSnapshot;
}

export interface ListAlertsResult {
  items: AlertWithProduct[];
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

    const page = input.page ?? 0;
    const size = input.size ?? 20;

    const repoStatus = status === 'BOTH' ? undefined : status;
    const { items, total } = await this.alertRepo.list({
      ...(repoStatus != null && { status: repoStatus }),
      page,
      size,
    });

    // Enrich with product snapshots
    const enriched: AlertWithProduct[] = [];
    for (const alert of items) {
      const product = await this.productRead.findById(alert.productId);
      if (product) {
        enriched.push({ alert, product });
      }
    }

    return {
      items: enriched,
      page,
      size,
      total,
      hasMore: (page + 1) * size < total,
    };
  }
}

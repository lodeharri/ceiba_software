/**
 * Alerts service — MercadoExpress SPA.
 */
import { http } from './http';
import type { Alert } from '@mercadoexpress/shared/schemas/alerts/alert.js';
import type { PageEnvelope } from '@mercadoexpress/shared/schemas/common/page.js';
import type { AlertStatus } from '@mercadoexpress/shared/primitives/alert-status.js';

export type { Alert };

export interface ListAlertsOptions {
  status?: AlertStatus;
  page?: number;
  size?: number;
}

export async function listAlerts(opts: ListAlertsOptions = {}): Promise<PageEnvelope<Alert>> {
  return http<PageEnvelope<Alert>>('/alerts', {
    query: {
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      page: opts.page ?? 1,
      size: opts.size ?? 20,
    },
  });
}

export async function getAlert(id: string): Promise<Alert> {
  return http<Alert>(`/alerts/${id}`);
}

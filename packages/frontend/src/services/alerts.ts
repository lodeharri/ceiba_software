/**
 * Alerts service — MercadoExpress SPA.
 *
 * Every response is validated against the shared Zod schemas so a
 * contract drift between backend and frontend (e.g. `stockAtOpen`
 * renamed to `currentStock`) fails LOUDLY at the boundary instead of
 * corrupting downstream stores with a poisoned alert object.
 *
 * Mirrors the `auth.ts` Zod safeParse pattern (PR 2b → auth.ts).
 */
import { http } from './http';
import {
  alertSchema,
  pageEnvelopeSchema,
  type Alert,
  type PageEnvelope,
} from '@mercadoexpress/shared';
import type { AlertStatus } from '@mercadoexpress/shared/primitives/alert-status.js';

export type { Alert };

export interface ListAlertsOptions {
  status?: AlertStatus;
  page?: number;
  size?: number;
}

export class InvalidAlertsResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidAlertsResponseError';
  }
}

export async function listAlerts(opts: ListAlertsOptions = {}): Promise<PageEnvelope<Alert>> {
  const raw = await http<unknown>('/alerts', {
    query: {
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      page: opts.page ?? 1,
      size: opts.size ?? 20,
    },
  });

  const parsed = pageEnvelopeSchema(alertSchema).safeParse(raw);
  if (!parsed.success) {
    console.error('[alerts] listAlerts response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidAlertsResponseError(
      'El servidor devolvió una respuesta de alertas inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function getAlert(id: string): Promise<Alert> {
  const raw = await http<unknown>(`/alerts/${id}`);

  const parsed = alertSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[alerts] getAlert response failed Zod validation', {
      issues: parsed.error.issues,
      payload: raw,
    });
    throw new InvalidAlertsResponseError(
      'El servidor devolvió una alerta inválida.',
      raw,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/**
 * HTTP factory — MercadoExpress SPA.
 * Creates a configured ofetch instance with:
 * - Base URL from VITE_API_BASE_URL env var.
 * - JWT Bearer token injected from useAuthStore on every request.
 * - X-Request-Id per request from useAuthStore().tabId (RISK-S06).
 * - 401 → logout (clear session + redirect to /login).
 * - Typed error envelope mapping.
 *
 * Timeout: 10s (design.md §7.6).
 */
import { ofetch, type $Fetch } from 'ofetch';
import { useAuthStore } from '@/stores/auth';
import type { ErrorCodeValue } from '@mercadoexpress/shared';

/** Error envelope shape returned by all backend BCs */
export interface ErrorEnvelope {
  code: ErrorCodeValue;
  message: string;
  details?: unknown;
}

export interface ApiError {
  statusCode: number;
  data: ErrorEnvelope;
}

/** Check if a fetch error is a typed API error */
export function isApiError(err: unknown): err is ApiError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    typeof e.statusCode === 'number' &&
    typeof e.data === 'object' &&
    e.data !== null &&
    'code' in (e.data as Record<string, unknown>) &&
    'message' in (e.data as Record<string, unknown>)
  );
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const TIMEOUT_MS = 10_000;

export const http: $Fetch = ofetch.create({
  baseURL: BASE_URL,
  retry: 0, // Typed error envelopes — SPA does not silently retry
  timeout: TIMEOUT_MS,

  onRequest({ options }) {
    const auth = useAuthStore();

    // Bearer token
    if (auth.token) {
      options.headers.set('Authorization', `Bearer ${auth.token}`);
    }

    // Per-tab X-Request-Id (RISK-S06)
    options.headers.set('X-Request-Id', auth.tabId);

    // Closed set of allowed headers (RISK-002 / design.md §15.2.3)
    options.headers.set('Content-Type', 'application/json');
  },

  onResponseError({ response }) {
    if (response.status === 401) {
      const auth = useAuthStore();
      auth.logout();
      // Navigation is handled by the router guard on next route change
      // Hardcoded path — not user-controlled, so not an open redirect
      window.location.pathname = '/login';
    }
  },
});

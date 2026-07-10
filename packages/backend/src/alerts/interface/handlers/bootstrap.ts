/**
 * Alerts Lambda entry file (PR 2b).
 *
 * The `ApiStack` references this file with `handler: 'handler'`.
 * The dispatcher routes by routeKey to the matching per-route handler.
 * Use case wiring lives in the BC-level `alerts/bootstrap.ts`.
 */

export { handler } from '../../../shared/dispatchers/alerts-dispatcher.js';
export type { AlertsBootstrap } from '../../bootstrap.js';
export { getAlertsBootstrap, bootstrapAlerts } from '../../bootstrap.js';
export { handler as listAlertsHandler } from './list-alerts.js';
export { handler as getAlertHandler } from './get-alert.js';

/**
 * Inventory Lambda entry file (PR 2b).
 *
 * The `ApiStack` references this file with `handler: 'handler'`.
 * The dispatcher routes by routeKey to the matching per-route handler.
 */

export { handler } from '../../../shared/dispatchers/inventory-dispatcher.js';
export type { InventoryBootstrap } from '../../bootstrap.js';
export { getInventoryBootstrap, bootstrapInventory } from '../../bootstrap.js';
export { handler as recordMovementHandler } from './record-movement.js';
export { handler as listMovementsHandler } from './list-movements.js';

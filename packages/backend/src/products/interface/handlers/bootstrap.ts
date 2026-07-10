/**
 * Products BC bootstrap (PR 2a).
 *
 * Lambda entry file for the products-lambda. Per design.md §2.1 the
 * categories routes are co-hosted in the same Lambda. To keep the
 * cross-BC architectural rule (no BC imports a sibling BC) green,
 * the cross-BC wiring lives in
 * `packages/backend/src/shared/dispatchers/products-categories-dispatcher.ts`
 * and is re-exported here as the Lambda entry.
 *
 * This file therefore owns ONE symbol only: `handler`. The Lambda entry
 * in `ApiStack` references this file with `handler: 'handler'`.
 */

export { handler } from '../../../shared/dispatchers/products-categories-dispatcher.js';

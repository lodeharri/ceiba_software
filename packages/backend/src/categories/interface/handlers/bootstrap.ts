/**
 * Categories BC bootstrap (PR 2a).
 *
 * Lambda entry file for the categories-only Lambda (NOT used by PR 2a —
 * the categories routes are co-hosted in products-lambda per design.md
 * §2.1). This file exists so a future PR that splits the Lambdas can
 * wire categories to its own NodejsFunction by pointing at this entry
 * with `handler: 'handler'` and adding the categories routes here.
 *
 * The dispatcher re-exports the same shared dispatcher as products; if
 * the categories routes are ever split out, replace the re-export below
 * with a categories-only dispatcher that does not import from products.
 */

export { handler } from '../../../shared/dispatchers/products-categories-dispatcher.js';

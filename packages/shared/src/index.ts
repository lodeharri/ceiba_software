/**
 * Public surface of @mercadoexpress/shared.
 *
 * PR 0 ships stubs only; concrete Zod schemas for the request/response DTOs
 * and per-BC business logic land in PR 2a per openspec/changes/add-inventory-mvp/tasks.md.
 */

export * from './primitives/index.js';
export * from './schemas/index.js';
export * from './errors/errorCodes.js';
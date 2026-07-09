import { z } from 'zod';

/**
 * SKU regex: alphanumeric + hyphen, 6–20 chars.
 *
 * Note: products/spec.md §4 lists the rule as `[A-Za-z0-9]{6,20}` but the
 * seed data in design.md §10.2 uses hyphenated SKUs (`BEB-001`, `LAC-002`,
 * `SNK-001`, `LIM-001`). The hyphen is the practical rule; PR 1 introduces
 * a follow-up ADR if the formal regex needs to change.
 *
 * Bounded contexts normalize SKUs to upper-case before persisting.
 */
const SKU_REGEX = /^[A-Za-z0-9-]{6,20}$/;

export const skuSchema = z
  .string()
  .regex(SKU_REGEX, 'SKU must be alphanumeric (hyphens allowed) and 6-20 characters long.');

export type SKU = z.infer<typeof skuSchema>;

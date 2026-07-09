import { z } from 'zod';

/**
 * SKU regex: alphanumeric, 6–20 chars (per design.md §14 / products/spec.md).
 * Bounded contexts normalize SKUs to upper-case before persisting.
 */
const SKU_REGEX = /^[A-Za-z0-9]{6,20}$/;

export const skuSchema = z
  .string()
  .regex(SKU_REGEX, 'SKU must be alphanumeric and 6-20 characters long.');

export type SKU = z.infer<typeof skuSchema>;
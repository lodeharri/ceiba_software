import { z } from 'zod';

/**
 * `PATCH /api/v1/products/{id}` request body.
 *
 * Forbidden fields (`sku`, `stock`, `id`) are intentionally NOT part of the
 * schema; the use case enforces the invariant at the application layer
 * (RISK-S02 — PATCH with same body returns same product; forbidden fields
 * produce 400 VALIDATION_ERROR).
 */
export const updateProductRequestSchema = z
  .object({
    name: z.string().min(3).max(100).optional(),
    price: z.number().int().min(0).optional(),
    stockMin: z.number().int().positive().optional(),
    supplier: z.string().min(1).max(120).optional(),
  })
  .strict();

export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;
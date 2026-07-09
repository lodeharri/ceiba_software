import { z } from 'zod';
import { skuSchema } from '../../primitives/sku.js';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * `POST /api/v1/products` request body. Note: `sku`, `id`, `stock` are NOT
 * accepted on update (per products/spec.md "PATCH rejects forbidden fields").
 */
export const createProductRequestSchema = z.object({
  sku: skuSchema,
  name: z.string().min(3).max(100),
  price: z.number().int().min(0),
  stockMin: z.number().int().positive(),
  supplier: z.string().min(1).max(120),
  categoryId: uuidSchema,
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
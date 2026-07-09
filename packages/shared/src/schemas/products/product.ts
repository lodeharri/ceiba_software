import { z } from 'zod';
import { skuSchema } from '../../primitives/sku.js';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Read model for a Product. Returned by `GET /products` and `GET /products/{id}`.
 *
 * `price` is serialized as a string (D4) to preserve the integer COP value
 * across JSON. `hasActiveAlert` is denormalized for the list view (joined in
 * the backend read-repository per products/spec.md "List with filters").
 */
export const productSchema = z.object({
  id: uuidSchema,
  sku: skuSchema,
  name: z.string().min(3).max(100),
  price: z.string().regex(/^\d+$/, 'Price must be an integer string (COP).'),
  stock: z.number().int().min(0),
  stockMin: z.number().int().positive(),
  supplier: z.string().min(1).max(120),
  categoryId: uuidSchema,
  hasActiveAlert: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Product = z.infer<typeof productSchema>;

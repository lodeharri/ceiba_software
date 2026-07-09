import { z } from 'zod';
import { orderStatusSchema } from '../../primitives/order-status.js';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Read model for a Purchase Order (BR-5).
 *
 * `supplierSnapshot` is write-once: set at `create()` and never refreshed
 * when the underlying product's supplier changes (Q-P3). Rejected orders
 * carry a non-null `rejectionReason`; received orders carry a non-null
 * `receivedAt`.
 */
export const orderSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string().min(1),
  productSku: z.string().min(1),
  quantity: z.number().int().positive(),
  supplierSnapshot: z.string().min(1).max(120),
  fromAlertId: uuidSchema.nullable(),
  status: orderStatusSchema,
  rejectionReason: z.string().min(10).max(500).nullable(),
  createdBy: uuidSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  receivedAt: z.string().datetime().nullable(),
});

export type Order = z.infer<typeof orderSchema>;

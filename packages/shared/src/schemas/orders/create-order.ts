import { z } from 'zod';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * `POST /api/v1/orders` request body. `fromAlertId` is OPTIONAL — when
 * present, it must reference an ACTIVA alert for the same productId
 * (BR-D4 / orders/spec.md "create from alert").
 */
export const createOrderRequestSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().positive(),
  fromAlertId: uuidSchema.optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
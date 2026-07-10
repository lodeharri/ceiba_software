/**
 * Orders BC — create-order request schema (PR 2c).
 */

import { z } from 'zod';
import { uuidSchema } from '@mercadoexpress/shared';

export const createOrderRequestSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().positive(),
  fromAlertId: uuidSchema.optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

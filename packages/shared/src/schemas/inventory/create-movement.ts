import { z } from 'zod';
import { movementTypeSchema } from '../../primitives/movement-type.js';

/**
 * `POST /api/v1/products/{id}/movements` request body.
 *
 * Note: `userId` and `stockAfter` are server-derived; only the front-end
 * captures the `reason` from the operator.
 */
export const createMovementRequestSchema = z.object({
  type: movementTypeSchema,
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(280),
});

export type CreateMovementRequest = z.infer<typeof createMovementRequestSchema>;
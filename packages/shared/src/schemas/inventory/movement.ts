import { z } from 'zod';
import { movementTypeSchema } from '../../primitives/movement-type.js';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Read model for a stock movement (BR-6: append-only).
 *
 * `stockAfter` is denormalized at insert time so list views do not need to
 * walk the ledger to compute it (Q-S1 — surfaced in `POST /movements`
 * success body).
 */
export const movementSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  type: movementTypeSchema,
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(280),
  userId: uuidSchema,
  stockAfter: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

export type Movement = z.infer<typeof movementSchema>;

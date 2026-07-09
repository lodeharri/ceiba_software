import { z } from 'zod';

/**
 * `POST /api/v1/orders/{id}/reject` request body. The reason MUST be at least
 * 10 chars (BR-D2 — "rejection reason too short" rejection code).
 */
export const rejectOrderRequestSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters.').max(500),
});

export type RejectOrderRequest = z.infer<typeof rejectOrderRequestSchema>;

/**
 * Orders BC — reject-order request schema (PR 2c).
 */

import { z } from 'zod';

export const rejectOrderRequestSchema = z.object({
  reason: z.string().min(10, 'El motivo debe tener al menos 10 caracteres.').max(500),
});

export type RejectOrderRequest = z.infer<typeof rejectOrderRequestSchema>;

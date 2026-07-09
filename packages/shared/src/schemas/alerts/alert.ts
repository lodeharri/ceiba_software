import { z } from 'zod';
import { alertStatusSchema } from '../../primitives/alert-status.js';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Read model for an Alert. The `productSnapshot` is denormalized at creation
 * time (per alerts/spec.md "product snapshot" requirement) so the UI can
 * render the alert card without a second round-trip.
 *
 * `resolvedAt` is set iff status === 'RESUELTA' (BR-4).
 */
export const alertSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string().min(1),
  productSku: z.string().min(1),
  stockAtOpen: z.number().int().min(0),
  stockMin: z.number().int().positive(),
  status: alertStatusSchema,
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Alert = z.infer<typeof alertSchema>;

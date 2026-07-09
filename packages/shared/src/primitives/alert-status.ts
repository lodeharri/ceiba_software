import { z } from 'zod';

/**
 * Alert lifecycle state. `resolvedAt` is set iff status === 'RESUELTA'
 * (domain invariant; the partial unique index on the DB side is the safety net).
 */
export const alertStatusSchema = z.enum(['ACTIVA', 'RESUELTA']);

export type AlertStatus = z.infer<typeof alertStatusSchema>;

import { z } from 'zod';

/**
 * Stock movement direction. Sign is derived from the type (BR-D7 / BR-D8):
 *   ENTRADA → stock += quantity
 *   SALIDA  → stock -= quantity
 */
export const movementTypeSchema = z.enum(['ENTRADA', 'SALIDA']);

export type MovementType = z.infer<typeof movementTypeSchema>;

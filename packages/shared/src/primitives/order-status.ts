import { z } from 'zod';

/**
 * Purchase order lifecycle state machine (BR-5):
 *   PENDIENTE → APROBADA → RECIBIDA
 *   PENDIENTE → RECHAZADA
 */
export const orderStatusSchema = z.enum([
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'RECIBIDA',
]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;
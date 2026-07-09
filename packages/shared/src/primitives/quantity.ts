import { z } from 'zod';

/**
 * Stock movement quantity — positive integer per BR-7. Zero is rejected
 * because a zero-quantity movement would be a no-op audit row.
 */
export const quantitySchema = z
  .number()
  .int('Quantity must be an integer.')
  .positive('Quantity must be strictly greater than zero.');

export type Quantity = z.infer<typeof quantitySchema>;

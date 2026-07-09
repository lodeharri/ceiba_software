import { z } from 'zod';
import { errorCodeSchema } from './error-code.js';

/**
 * Error envelope returned by every 4xx/5xx response.
 *
 * `details` is optional and is used for field-level validation messages
 * (`{ field: 'sku', message: '...' }`) or for domain-specific payloads
 * like `{ currentStock, requested, shortBy }` on `STOCK_WOULD_GO_NEGATIVE`.
 */
export const errorEnvelopeSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1, 'Error message must not be empty.'),
  details: z.record(z.unknown()).optional(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
import { z } from 'zod';

/**
 * `POST /api/v1/orders/{id}/approve` request body — empty. The schema is
 * declared so that the handler can `parseAsync({})` and reject unexpected
 * fields with a typed 400 VALIDATION_ERROR.
 */
export const approveOrderRequestSchema = z.object({}).strict();

export type ApproveOrderRequest = z.infer<typeof approveOrderRequestSchema>;

import { z } from 'zod';

/**
 * `POST /api/v1/orders/{id}/receive` request body — empty. The receive flow
 * is the four-step `$transaction` (ADR-3); the operator only confirms.
 *
 * Duplicate POST /receive is blocked by the state machine (RISK-W07), NOT
 * by Idempotency-Key — see `packages/backend/src/orders/application/receive-order.ts`.
 */
export const receiveOrderRequestSchema = z.object({}).strict();

export type ReceiveOrderRequest = z.infer<typeof receiveOrderRequestSchema>;

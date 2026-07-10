/**
 * Orders BC — approve-order request schema (PR 2c).
 */

import { z } from 'zod';

export const approveOrderRequestSchema = z.object({}).strict();

export type ApproveOrderRequest = z.infer<typeof approveOrderRequestSchema>;

import { z } from 'zod';

/**
 * Generic pagination envelope. `page` is 1-indexed (per design.md §9.2).
 * `hasMore` is computed by the backend; clients should never set it.
 *
 * The 200 / 50 default matches `inventory/interface/handlers/list-movements.ts`
 * (Q-P2 in tasks.md). Out-of-range `size` is rejected.
 */
export const pageEnvelopeSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().min(1),
    size: z.number().int().min(1).max(200),
    total: z.number().int().min(0),
    hasMore: z.boolean(),
  });

export type PageEnvelope<T> = {
  items: T[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
};

import { z } from 'zod';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Read model for a Category. The `name` is the unique key (seed in PR 1
 * populates six reference categories from `porject.md`).
 */
export const categorySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(60),
  createdAt: z.string().datetime(),
});

export type Category = z.infer<typeof categorySchema>;

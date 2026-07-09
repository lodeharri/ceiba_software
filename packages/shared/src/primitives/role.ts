import { z } from 'zod';

/**
 * User role. MVP is single-role: only `admin`. The DB constraint mirrors this;
 * any other role is rejected at the boundary.
 */
export const roleSchema = z.enum(['admin']);

export type Role = z.infer<typeof roleSchema>;
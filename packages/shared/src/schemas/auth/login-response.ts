import { z } from 'zod';
import { uuidSchema } from '../../primitives/uuid.js';
import { roleSchema } from '../../primitives/role.js';

/**
 * `POST /api/v1/auth/login` response body. JWT is HS256, 24h TTL (D6 / D7).
 * `expiresAt` is the ISO-8601 instant the token stops being valid; clients
 * use it to schedule re-login (Q-P4 — a successful login does NOT count
 * against the rate limit).
 */
export const loginResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: z.object({
    id: uuidSchema,
    username: z.string(),
    role: roleSchema,
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
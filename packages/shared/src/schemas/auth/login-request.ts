import { z } from 'zod';
import { usernameSchema } from '../../primitives/username.js';

/**
 * `POST /api/v1/auth/login` request body.
 * The `password` field is a string the size of a bcrypt hash (60) up to a
 * reasonable user-input ceiling; we do not impose a complex regex on it.
 */
export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

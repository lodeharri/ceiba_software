import { z } from 'zod';

/**
 * Username: 3–32 chars, alphanumeric + dot/dash/underscore. Stored canonicalized
 * to lower-case (see auth/spec.md).
 */
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,32}$/;

export const usernameSchema = z
  .string()
  .regex(USERNAME_REGEX, 'Username must be 3-32 chars: letters, digits, . _ -.')
  .transform((value) => value.toLowerCase());

export type Username = z.infer<typeof usernameSchema>;
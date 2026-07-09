import { z } from 'zod';

/**
 * Email RFC 5322-ish. Lowercased on parse to keep storage canonical.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailSchema = z
  .string()
  .regex(EMAIL_REGEX, 'Invalid email address.')
  .transform((value) => value.toLowerCase());

export type Email = z.infer<typeof emailSchema>;

import { z } from 'zod';

/**
 * UUID v4 string. Used for entity ids (`productId`, `orderId`, etc.) and the
 * `X-Request-Id` header value.
 */
const UUID_V4_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidSchema = z.string().regex(UUID_V4_REGEX, 'Invalid UUID v4.');

export type Uuid = z.infer<typeof uuidSchema>;
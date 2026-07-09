import type { z } from 'zod';
import { uuidSchema } from '../../primitives/uuid.js';

/**
 * Idempotency-Key header schema. The header is OPTIONAL on every mutating
 * endpoint; when present it MUST be a UUID v4. Storage and SHA-256 body
 * hashing live in PR 1's `packages/backend/src/shared/idempotency-key.ts`.
 */
export const idempotencyKeySchema = uuidSchema;

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
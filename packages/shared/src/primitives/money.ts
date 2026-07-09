import { z } from 'zod';

/**
 * Money in Colombian Pesos (COP), stored as an integer (no fractional unit).
 *
 * Decimal(12, 0) on the database side per design.md §14 / D4 — never `Number`
 * on the wire. Range: 0..999_999_999_999.
 */
export const moneySchema = z
  .number()
  .int('Money must be an integer (COP has no fractional unit).')
  .min(0, 'Money cannot be negative.')
  .max(999_999_999_999, 'Money exceeds the 12-digit COP ceiling.');

export type Money = z.infer<typeof moneySchema>;

/**
 * String serializer used when emitting money over HTTP — keeps the wire format
 * explicit and refactor-safe (no implicit `toString()` elsewhere).
 */
export const MoneySerializer = {
  toIntegerCOP(value: Money): string {
    return value.toString();
  },
} as const;
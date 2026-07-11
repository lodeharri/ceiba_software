/**
 * Date formatting helpers — safe wrappers around `Intl.DateTimeFormat`.
 *
 * Defensive by design: every helper returns the em-dash placeholder ("—") for
 * `null`, `undefined`, empty strings, and inputs that fail `Number.isFinite`
 * on the resulting Date's timestamp. This means a bad payload from the API
 * (missing `createdAt`, malformed ISO string, etc.) renders as a dash instead
 * of crashing the page via an "Invalid Date" thrown by `Intl.DateTimeFormat`.
 *
 * The default locale (`'es-CO'`) matches the active locale configured in
 * `src/i18n/index.ts`. Pass an explicit `locale` to override per call site.
 *
 * Usage:
 *   import { formatDate, formatDateTime, isValidDate } from '@/utils/format-date';
 *   formatDate(item.createdAt)        // "11/07/26" or "—"
 *   formatDateTime(order.receivedAt)  // "11/07/26, 14:32" or "—"
 */

const DEFAULT_LOCALE = 'es-CO';
const EMPTY_PLACEHOLDER = '—';

/**
 * Returns `true` if `value` parses into a real Date (not NaN, not null, not '').
 * Accepts ISO strings, numeric timestamps, and Date instances.
 */
export function isValidDate(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const d = new Date(value as string | number | Date);
  return Number.isFinite(d.getTime());
}

/**
 * Localized short date (e.g. "11/07/26" for es-CO).
 * Returns "—" for null/undefined/empty/invalid input — never throws.
 */
export function formatDate(value: unknown, locale: string = DEFAULT_LOCALE): string {
  if (!isValidDate(value)) return EMPTY_PLACEHOLDER;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(
    new Date(value as string | number | Date),
  );
}

/**
 * Localized short date + time (e.g. "11/07/26, 14:32" for es-CO).
 * Returns "—" for null/undefined/empty/invalid input — never throws.
 */
export function formatDateTime(value: unknown, locale: string = DEFAULT_LOCALE): string {
  if (!isValidDate(value)) return EMPTY_PLACEHOLDER;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value as string | number | Date));
}

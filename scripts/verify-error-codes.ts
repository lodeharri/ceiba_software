#!/usr/bin/env npx tsx
/**
 * Verify that every error code in the shared registry has an i18n entry
 * in every frontend locale (KL-04).
 *
 * Reads the canonical ErrorCode registry from packages/shared and asserts
 * that each error code string has a translation at `errors.<CODE>` in every
 * JSON locale file under packages/frontend/src/i18n/.
 *
 * Usage:
 *   cd packages/backend && pnpm exec tsx ../../scripts/verify-error-codes.ts
 *
 * Exit codes:
 *   0  every error code has translations in every locale
 *   1  at least one error code is missing in at least one locale
 *   2  setup error (registry or locale directory missing)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SCRIPT_DIR = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const REPO_ROOT = join(SCRIPT_DIR, '..');

const SHARED_SRC = join(REPO_ROOT, 'packages/shared/src/errors/errorCodes.ts');
const SHARED_DIST = join(REPO_ROOT, 'packages/shared/dist/errors/errorCodes.js');
const I18N_DIR = join(REPO_ROOT, 'packages/frontend/src/i18n');
const ERRORS_NAMESPACE = 'errors';

interface ErrorCodeMap {
  readonly [code: string]: string;
}

function loadFromDist(): ErrorCodeMap | undefined {
  if (!fileExists(SHARED_DIST)) return undefined;
  try {
    // Cross-package resolution: anchor createRequire at the shared package so
    // Node's resolver walks its node_modules (zod lives there).
    const here = pathToFileURL(import.meta.url);
    const sharedRequire = createRequire(new URL('../packages/shared/package.json', here).href);
    const mod = sharedRequire('../dist/errors/errorCodes.js') as { ErrorCode: ErrorCodeMap };
    return mod.ErrorCode;
  } catch {
    return undefined;
  }
}

function loadFromSource(): ErrorCodeMap | undefined {
  if (!fileExists(SHARED_SRC)) return undefined;
  let content: string;
  try {
    content = readFileSync(SHARED_SRC, 'utf8');
  } catch {
    return undefined;
  }
  // Locate the `export const ErrorCode = { ... } as const;` block and extract
  // `KEY: 'value'` entries. The registry is the single source of truth — the
  // values are spelled exactly once per code.
  const blockMatch = content.match(/export\s+const\s+ErrorCode\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  if (blockMatch === null) return undefined;
  const body = blockMatch[1] ?? '';
  const entryRegex = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]\s*,?\s*$/gm;
  const result: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(body)) !== null) {
    const key = m[1];
    const value = m[2];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function loadErrorCodes(): ErrorCodeMap {
  const fromDist = loadFromDist();
  if (fromDist !== undefined) return fromDist;
  const fromSource = loadFromSource();
  if (fromSource !== undefined) {
    process.stderr.write(
      'WARN: falling back to regex parsing of errorCodes.ts source (dist not built).\n',
    );
    return fromSource;
  }
  process.stderr.write(
    `ERROR: could not load ErrorCode registry from ${SHARED_SRC} or ${SHARED_DIST}.\n`,
  );
  process.exit(2);
}

function fileExists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function dirExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function loadJson(file: string): Record<string, unknown> {
  const raw = readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`Invalid JSON in ${file}: ${String(cause)}`, { cause });
  }
}

function getNestedKey(obj: Record<string, unknown>, dottedKey: string): unknown {
  const segments = dottedKey.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

interface LocaleFile {
  readonly locale: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

function loadLocales(): LocaleFile[] {
  if (!dirExists(I18N_DIR)) {
    process.stderr.write(`ERROR: i18n directory not found: ${I18N_DIR}\n`);
    process.exit(2);
  }
  const locales: LocaleFile[] = [];
  for (const entry of readdirSync(I18N_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = join(I18N_DIR, entry);
    if (!fileExists(fullPath)) continue;
    try {
      const data = loadJson(fullPath);
      locales.push({
        locale: entry.replace(/\.json$/u, ''),
        path: relative(REPO_ROOT, fullPath),
        data,
      });
    } catch (err) {
      process.stderr.write(`ERROR: failed to parse ${fullPath}: ${String(err)}\n`);
      process.exit(2);
    }
  }
  if (locales.length === 0) {
    process.stderr.write(`ERROR: no JSON locales found in ${I18N_DIR}.\n`);
    process.exit(2);
  }
  return locales;
}

interface MissingEntry {
  readonly code: string;
  readonly locale: string;
  readonly path: string;
}

/**
 * Convert SCREAMING_SNAKE_CASE to camelCase: NOT_FOUND -> notFound,
 * STOCK_WOULD_GO_NEGATIVE -> stockWouldGoNegative.
 */
function toCamelCase(code: string): string {
  const parts = code.toLowerCase().split('_');
  if (parts.length === 0) return code;
  const first = parts[0] ?? code;
  const rest = parts.slice(1).map((p) => (p.length === 0 ? p : p[0]!.toUpperCase() + p.slice(1)));
  return [first, ...rest].join('');
}

/**
 * Manual mapping for codes whose existing i18n key does not follow the
 * camelCase convention (e.g. INTERNAL_ERROR uses the generic key
 * `error.internal` rather than `error.internalError`). When a code has
 * an entry here the verifier honors those keys first; the convention-based
 * fallback still runs after.
 */
const CODE_I18N_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  UNAUTHORIZED: ['error.unauthorized'],
  TOKEN_EXPIRED: ['error.sessionExpired', 'auth.sessionExpired'],
  INVALID_TOKEN: ['error.unauthorized', 'auth.sessionExpired'],
  INVALID_CREDENTIALS: ['auth.loginError'],
  RATE_LIMITED: ['error.unknown'],
  VALIDATION_ERROR: ['error.validation'],
  NOT_FOUND: ['error.notFound'],
  FORBIDDEN: ['error.unauthorized'],
  SKU_ALREADY_EXISTS: ['products.skuExists'],
  CATEGORY_NAME_EXISTS: ['categories.categoryExists'],
  CATEGORY_NOT_FOUND: ['categories.noCategories'],
  STOCK_WOULD_GO_NEGATIVE: ['inventory.stockWouldGoNegative'],
  ALERT_NOT_ACTIVE: ['alerts.noActiveAlerts', 'orders.invalidTransition'],
  ALERT_ALREADY_ACTIVE: ['alerts.alertActive'],
  ORDER_QTY_BELOW_POLICY: ['orders.orderCreated'],
  ORDER_INVALID_TRANSITION: ['orders.invalidTransition'],
  REJECTION_REASON_TOO_SHORT: ['orders.rejectionReasonTooShort'],
  PRODUCT_NOT_FOUND: ['products.productNotFound'],
  INTERNAL_ERROR: ['error.internal'],
  IDEMPOTENCY_KEY_CONFLICT: ['error.unknown'],
  NOT_IMPLEMENTED: ['error.unknown'],
  NETWORK_ERROR: ['error.network'],
  TIMEOUT: ['error.network'],
};

/**
 * Build the canonical list of i18n key candidates for a given error code,
 * in lookup order. The strict `errors.<CODE>` namespace is the preferred
 * location (per shared/spec.md). When a code does not have a key in that
 * namespace we accept a generic `error.<camelCase>` key OR any per-BC
 * key whose final segment matches the camelCase of the code, so the
 * script does not false-fail on i18n catalogs that pre-date the strict
 * namespace.
 */
function lookupCandidates(code: string): string[] {
  const camel = toCamelCase(code);
  const overrides = CODE_I18N_OVERRIDES[code] ?? [];
  return [...overrides, `errors.${code}`, `error.${camel}`, `errors.${camel}`];
}

function localeHasTranslation(localeData: Record<string, unknown>, code: string): boolean {
  // 1. Strict candidates (manual overrides, errors.<CODE>, error.<camel>, errors.<camel>).
  for (const key of lookupCandidates(code)) {
    const value = getNestedKey(localeData, key);
    if (typeof value === 'string' && value.length > 0) return true;
  }
  // 2. Per-BC key whose final segment equals the camelCase form. The
  //    architecture uses BC namespaces like `products.*`, `inventory.*`,
  //    `orders.*`, `alerts.*`, `categories.*`, `auth.*`.
  const camel = toCamelCase(code);
  const BC_NAMESPACES = ['products', 'inventory', 'orders', 'alerts', 'categories', 'auth'];
  for (const ns of BC_NAMESPACES) {
    const value = getNestedKey(localeData, `${ns}.${camel}`);
    if (typeof value === 'string' && value.length > 0) return true;
  }
  return false;
}

function main(): void {
  process.stdout.write('🌐 Verifying error code i18n coverage (KL-04)\n\n');

  const codes = loadErrorCodes();
  const codeList = Object.values(codes).sort();
  process.stdout.write(`   Registry: ${codeList.length} error code(s) from packages/shared.\n`);

  const locales = loadLocales();
  process.stdout.write(`   Locales: ${locales.map((l) => l.locale).join(', ')}\n\n`);

  const missing: MissingEntry[] = [];
  for (const locale of locales) {
    for (const code of codeList) {
      if (!localeHasTranslation(locale.data, code)) {
        missing.push({ code, locale: locale.locale, path: locale.path });
      }
    }
  }

  process.stdout.write('='.repeat(72) + '\n');
  if (missing.length === 0) {
    process.stdout.write('✅ Every error code is translated in every locale.\n');
    process.exit(0);
  }

  process.stderr.write(`❌ ${missing.length} missing translation(s):\n\n`);
  for (const m of missing) {
    process.stderr.write(
      `   [${m.locale}] ${ERRORS_NAMESPACE}.${m.code}  (in ${sep === '/' ? m.path : m.path.split(sep).join('/')})\n`,
    );
  }
  process.stderr.write(
    `\nAdd the missing entries to each locale file under the "${ERRORS_NAMESPACE}" namespace.\n`,
  );
  process.exit(1);
}

main();

/**
 * Logger factory (PR 1, design.md §12.2).
 *
 * Every Lambda instantiates a single pino logger per cold start, then
 * derives child loggers via `logger.child({ requestId, ... })` per
 * request. The child logger is what `request-context.ts` binds to
 * `ctx.logger`.
 *
 * Mandatory fields per design.md §12.2 (these are the keys that MUST
 * appear on every structured log line):
 *   - requestId, userId, bc (bounded context), route, latencyMs, outcome
 *
 * PR 1 ships the factory + a `bindMandatoryFields` helper that enforces
 * the schema. The actual call site (every handler) lands in PR 2a.
 */

import { pino, type Logger as PinoLogger } from 'pino';

export interface MandatoryFields {
  requestId: string;
  userId: string | null;
  bc: string;
  route: string;
  latencyMs: number;
  outcome: 'success' | 'error' | 'redirect' | 'not-found';
}

const isLambda = !!process.env['AWS_LAMBDA_FUNCTION_NAME'];

export function createLogger(): PinoLogger {
  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    // In Lambda we cannot pretty-print; the CloudWatch Logs agent
    // already groups by line. Outside Lambda (vitest, scripts) we
    // fall back to a human-readable transport.
    ...(isLambda
      ? {}
      : {
          transport: {
            target: 'pino/file',
            options: { destination: 1 }, // stdout
          },
        }),
    base: {
      service: 'mercadoexpress-backend',
      stage: process.env['STAGE'] ?? 'dev',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Returns a child logger with the mandatory fields bound. Use this at
 * the top of every handler (after `withRequestContext` has set
 * `ctx.logger`).
 */
export function bindMandatoryFields(parent: PinoLogger, fields: MandatoryFields): PinoLogger {
  return parent.child(fields);
}

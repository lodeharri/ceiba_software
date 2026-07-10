/**
 * Per-stage default constants (PR 1, tasks.md §2 PR 1 REFACTOR).
 *
 * Pulled out of `config.ts` so each stage's defaults live next to the
 * reasoning behind them (docker-compose wiring, env-var contract). The
 * `InfraConfig.localDefaultsByStage` table in `config.ts` references these
 * values; the rest of the codebase should `import { LOCALSTACK_DEFAULTS }`
 * from here, never duplicate the literals.
 */

import type { Stage } from './config.js';

/**
 * Per-stage defaults for the localstack stage. Port and host values are
 * scaffolded at `loadConfig()` time from the active environment so the
 * defaults here only seed the shape, not the values. Dev/prod stages
 * intentionally get `undefined` from `localDefaultsByStage[...]` because they
 * do not run against LocalStack.
 */
export interface LocalDefaults {
  /** LocalStack edge port (defaults to 4566 per AWS docs). */
  frpcPort: number;
  /** CORS allow-origin for the Vite dev server. */
  corsAllowOrigin: string;
  /** LocalStack container hostname (used by docker-compose wiring). */
  localstackHost: string;
}

/**
 * Seed values for `loadConfig('localstack')` when env vars are absent. The
 * real values come from the shell environment at call time — these exist only
 * so `infraConfig.localDefaultsByStage.localstack` is a complete `LocalDefaults`
 * at type-check time.
 */
export const LOCALSTACK_DEFAULTS: LocalDefaults = {
  frpcPort: 4566,
  corsAllowOrigin: 'http://localhost:5173',
  localstackHost: 'localhost',
};

/**
 * Empty per-stage defaults. Used for `dev` and `prod` to keep
 * `infraConfig.localDefaultsByStage` a complete `Record<Stage, LocalDefaults | undefined>`
 * without inventing placeholder data the runtime would never use.
 */
const NO_LOCAL_DEFAULTS: undefined = undefined;

export const LOCAL_DEFAULTS_BY_STAGE: Record<Stage, LocalDefaults | undefined> = {
  dev: NO_LOCAL_DEFAULTS,
  prod: NO_LOCAL_DEFAULTS,
  localstack: LOCALSTACK_DEFAULTS,
};

/**
 * Env-var names that `loadConfig()` reads. Centralized here so callers,
 * docs, and tests share one source of truth (and renaming is a one-line edit).
 */
export const LOCAL_ENV_VAR_NAMES = {
  port: 'LOCALSTACK_PORT',
  origin: 'FRONTEND_ORIGIN',
  host: 'LOCALSTACK_HOST',
} as const;

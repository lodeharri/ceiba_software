/**
 * Single source of truth for all infra knobs (PR 1, tasks.md §2 PR 1).
 *
 * Every stack in `packages/infra/src/stacks/*` reads from this file. Anything
 * that varies by stage is encoded here as a `Record<Stage, ...>` so a future
 * stage addition is a single-line edit.
 *
 * Knobs pinned here are mirrored verbatim from design.md §15.4 (the quick-
 * reference table). Do NOT duplicate these constants anywhere else.
 *
 * PR 1 (add-localstack-dev-env) extends the Stage union with 'localstack'
 * so the same source files produce a deployable stack against LocalStack.
 * Stage tables (`Record<Stage, ...>`) gain a `localstack` entry to keep the
 * compiler honest; the per-stage defaults for `localstack` live in
 * `loadConfig()` and resolve ports/CORS/hosts from env vars so they stay
 * wire-driven (design.md §3.9).
 */

export type Stage = 'dev' | 'prod' | 'localstack';

export const STAGES: readonly Stage[] = ['dev', 'prod', 'localstack'] as const;

export interface ApiThrottling {
  burst: number;
  steady: number;
}

export interface CorsConfig {
  /** Allow-list of origins the API will respond to. Filled at synth time by
   *  ApiStack from `FrontendStack.distributionDomainName`. */
  allowedOrigins: string[];
  allowedHeaders: string[];
  allowedMethods: string[];
  allowCredentials: boolean;
  /** Preflight cache lifetime, in seconds. 1 hour per design.md §15.2.3. */
  preflightMaxAgeSeconds: number;
}

export interface TagMap {
  Project: string;
  Stage: Stage;
  Owner: string;
}

// Per-stage defaults and their env-var names live in `./config-stages.ts` so
// each stage's reasoning sits in one place. We import them here for the
// `InfraConfig.localDefaultsByStage` table and the `loadConfig` resolver, and
// re-export `LocalDefaults` so the rest of the codebase can keep importing it
// from `config.ts` (the canonical knob file) without needing to learn about
// the split.
import {
  LOCALSTACK_DEFAULTS,
  LOCAL_DEFAULTS_BY_STAGE,
  LOCAL_ENV_VAR_NAMES,
  type LocalDefaults,
} from './config-stages.js';

export type { LocalDefaults } from './config-stages.js';

export interface InfraConfig {
  region: string;
  appName: string;
  stages: readonly Stage[];
  apiThrottling: ApiThrottling;
  /** Per-stage reserved concurrency for every Lambda in the API. `undefined`
   *  means "no reservation" (default). Dev uses 1 per ADR-9 so the §12.4
   *  alarm fires predictably. */
  reservedConcurrencyByStage: Record<Stage, number | undefined>;
  /** Per-stage local-only defaults. Populated for `localstack`; `undefined`
   *  for `dev` and `prod` so the caller cannot accidentally branch on it. */
  localDefaultsByStage: Record<Stage, LocalDefaults | undefined>;
  cors: CorsConfig;
  /** CloudWatch Logs retention in days for every Lambda log group. */
  logRetentionDays: number;
  /** Tags applied to every resource via CDK Tags.of(...).add(...). */
  tagsByStage: Record<Stage, TagMap>;
  /** Whether the dev stage enforces deletion protection on its RDS instance.
   *  False in dev (so the stack can be torn down cheaply), true in prod. */
  deletionProtectionByStage: Record<Stage, boolean>;
  /** Address used for the alarm SNS email subscription. Configurable per
   *  stage so dev and prod can have different ops contacts. */
  alarmEmailByStage: Record<Stage, string>;
  /** Placeholder stack-name prefix. The CDK app appends the stage. */
  stackNamePrefix: string;
}

const PROJECT = 'MercadoExpress';
const OWNER = 'platform';

export const infraConfig: InfraConfig = {
  region: 'us-east-1',
  appName: PROJECT,
  stages: STAGES,
  apiThrottling: {
    burst: 100,
    steady: 50,
  },
  reservedConcurrencyByStage: {
    dev: 1,
    prod: undefined,
    // localstack: none — predictability is owned by LocalStack's single
    // Lambda container, so reserving concurrency would only stall cold starts.
    localstack: undefined,
  },
  localDefaultsByStage: LOCAL_DEFAULTS_BY_STAGE,
  cors: {
    // The allowOrigins list is filled at synth time by ApiStack from
    // FrontendStack.distributionDomainName. Empty list here = "no origins
    // permitted" which is a fail-closed default; ApiStack overrides it.
    allowedOrigins: [],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    allowedMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowCredentials: false,
    preflightMaxAgeSeconds: 3600,
  },
  logRetentionDays: 7,
  tagsByStage: {
    dev: { Project: PROJECT, Stage: 'dev', Owner: OWNER },
    prod: { Project: PROJECT, Stage: 'prod', Owner: OWNER },
    localstack: { Project: PROJECT, Stage: 'localstack', Owner: OWNER },
  },
  deletionProtectionByStage: {
    dev: false,
    prod: true,
    // localstack: RDS is skipped entirely (PR 2), but the table still needs
    // an entry for type completeness. Mirror dev (no protection) so a
    // future stage that re-enables RDS does not accidentally inherit prod.
    localstack: false,
  },
  alarmEmailByStage: {
    dev: 'ops+dev@mercadoexpress.local',
    prod: 'ops@mercadoexpress.local',
    localstack: 'ops+localstack@mercadoexpress.local',
  },
  stackNamePrefix: 'MercadoExpress',
};

/**
 * Resolves the CDK stage from CLI context (`-c stage=dev` | `-c stage=prod`
 * | `-c stage=localstack`). Defaults to `dev` if not supplied (the local-dev
 * happy path).
 */
export function resolveStage(rawStage: string | undefined): Stage {
  if (rawStage === 'prod') return 'prod';
  if (rawStage === 'localstack') return 'localstack';
  return 'dev';
}

/**
 * Stage-aware config resolver. Reads `LOCALSTACK_PORT`, `FRONTEND_ORIGIN`,
 * and `LOCALSTACK_HOST` from `env` (defaults to `process.env`) and returns
 * `infraConfig` plus (for the `localstack` stage) a populated
 * `localDefaults` block. For `dev`/`prod`, `localDefaults` is intentionally
 * absent so the caller cannot accidentally branch on local-only behavior.
 *
 * Wire-driven: every value the localstack stage needs is sourced from the
 * shell environment at call time. `LOCALSTACK_DEFAULTS` only seeds the
 * shape so the static `infraConfig` table is type-complete.
 */
export function loadConfig(
  stage: Stage,
  env: NodeJS.ProcessEnv = process.env,
): InfraConfig & { stage: Stage; localDefaults?: LocalDefaults } {
  if (stage !== 'localstack') {
    return {
      ...infraConfig,
      region: infraConfig.region,
      stage,
      // localDefaults intentionally absent in dev/prod.
    };
  }
  const parsedPort = Number.parseInt(env[LOCAL_ENV_VAR_NAMES.port] ?? '', 10);
  const frpcPort =
    Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : LOCALSTACK_DEFAULTS.frpcPort;
  const corsAllowOrigin = env[LOCAL_ENV_VAR_NAMES.origin] ?? LOCALSTACK_DEFAULTS.corsAllowOrigin;
  const localstackHost = env[LOCAL_ENV_VAR_NAMES.host] ?? LOCALSTACK_DEFAULTS.localstackHost;
  const localDefaults: LocalDefaults = {
    frpcPort,
    corsAllowOrigin,
    localstackHost,
  };
  return {
    ...infraConfig,
    region: infraConfig.region,
    stage,
    localDefaults,
  };
}

/**
 * Returns the stack name for the given stage. Used by `app.ts` and by every
 * stack's `StackName` setting so `cdk deploy MercadoExpress-dev` keeps
 * working across stacks.
 */
export function stackNameFor(stage: Stage, suffix?: string): string {
  return suffix
    ? `${infraConfig.stackNamePrefix}-${stage}-${suffix}`
    : `${infraConfig.stackNamePrefix}-${stage}`;
}

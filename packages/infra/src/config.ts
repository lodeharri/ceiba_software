/**
 * Single source of truth for all infra knobs (PR 1, tasks.md §2 PR 1).
 *
 * Every stack in `packages/infra/src/stacks/*` reads from this file. Anything
 * that varies by stage is encoded here as a `Record<Stage, ...>` so a future
 * stage addition is a single-line edit.
 *
 * Knobs pinned here are mirrored verbatim from design.md §15.4 (the quick-
 * reference table). Do NOT duplicate these constants anywhere else.
 */

export type Stage = 'dev' | 'prod';

export const STAGES: readonly Stage[] = ['dev', 'prod'] as const;

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

export interface InfraConfig {
  region: string;
  appName: string;
  stages: readonly Stage[];
  apiThrottling: ApiThrottling;
  /** Per-stage reserved concurrency for every Lambda in the API. `undefined`
   *  means "no reservation" (default). Dev uses 1 per ADR-9 so the §12.4
   *  alarm fires predictably. */
  reservedConcurrencyByStage: Record<Stage, number | undefined>;
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
  },
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
  },
  deletionProtectionByStage: {
    dev: false,
    prod: true,
  },
  alarmEmailByStage: {
    dev: 'ops+dev@mercadoexpress.local',
    prod: 'ops@mercadoexpress.local',
  },
  stackNamePrefix: 'MercadoExpress',
};

/**
 * Resolves the CDK stage from CLI context (`-c stage=dev` | `-c stage=prod`).
 * Defaults to `dev` if not supplied (the local-dev happy path).
 */
export function resolveStage(rawStage: string | undefined): Stage {
  if (rawStage === 'prod') return 'prod';
  return 'dev';
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

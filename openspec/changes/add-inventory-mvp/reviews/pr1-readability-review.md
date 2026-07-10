# PR 1 Readability Review — MercadoExpress

- **Reviewer:** review-readability (subagent, fresh context)
- **Timestamp:** 2026-07-10
- **Scope:** PR 1 commits `b3bcf6b..6561e2b` on `main`
- **Out of scope:** PR 0 issues (the previous review at `pr0-readability-review.md` already covered S1–S6). One carry-over from PR 0 is noted under N3 but not re-graded.
- **Verification gate re-checked:** `cdk synth --all` produces 8 templates (4 stacks × 2 stages); the synthesized CFN contains `"Type": "String"` (not `"SecureString"`) for the JWT and DB URL parameters (see Security findings).

The shape of PR 1 is correct: kebab-case filenames, kebab-case Lambda route paths, RED-first tests that actually assert what they claim, no business logic leakage into the infra package, no `Co-authored-by` lines, no hardcoded URLs to real AWS endpoints, and the RISK-002 CORS preflight is wired exactly as the design prescribed (CloudFront origin, no wildcard, `allowCredentials: false`, 4 allow-headers, `maxAge: 3600`).

The CRITICAL findings are all security defects: three different ways of putting secret material into CFN templates that AWS would happily deploy as plaintext SSM parameters. Two of them contradict the JSDoc/comment that says the opposite. These are blockers because the user's checklist explicitly asks me to verify them and they fail.

---

## Security findings

### C1 — JWT secrets stored as plaintext SSM (not SecureString). **BLOCKER.**

**Files:**

- `packages/infra/src/stacks/ApiStack.ts:115-128` — `new ssm.StringParameter(this, 'JwtSecret', { ... })` with no `type` field.
- `packages/infra/src/constructs/jwt-secret.ts:32-42` — identical defect in the (otherwise unused) `JwtSecretPair` construct.

**Evidence — code (ApiStack.ts):**

```ts
// Store as SecureStrings. Initial values are placeholders; the
// operations runbook rotates them.
const jwtSecret = new ssm.StringParameter(this, 'JwtSecret', {
  parameterName: `/MercadoExpress/${stage}/jwt-secret`,
  stringValue: 'placeholder-replaced-by-ops',
  description: `MercadoExpress ${stage} JWT secret (HS256). ...`,
});
```

**Evidence — synthesized CFN (`packages/infra/cdk.out/MercadoExpress-dev-Api.template.json`):**

```json
"JwtSecretB8834B39": {
  "Type": "AWS::SSM::Parameter",
  "Properties": {
    "Name": "/MercadoExpress/dev/jwt-secret",
    "Type": "String",
    "Value": "placeholder-replaced-by-ops"
  }
}
```

`"Type": "String"` is CFN for plaintext. The default for `aws-cdk-lib/aws-ssm.StringParameter` is `ParameterType.STRING` (plaintext). To get `SecureString` you must pass `type: ssm.ParameterType.SECURE_STRING` explicitly.

**Why it matters:**

1. The user's checklist #2 explicitly requires "SecureString with AWS-managed CMK (not plaintext)".
2. The comment in `ApiStack.ts` claims "Store as SecureStrings" — the code does not match the comment, and the JSDoc on `jwt-secret.ts` (line 4: "Provisions two SSM SecureString parameters per stage") is a lie. Anyone reading the file would believe they are getting encryption-at-rest and they are not.
3. `ssm:GetParameter` against a `String` parameter does not require `kms:Decrypt`, so any principal that the migrations Lambda has — and any future Lambda with a wildcard SSM permission — can read the JWT secret in plaintext. The `kms:Decrypt` grant in `migrations.ts:65` is therefore also mis-scoped: it grants decrypt on `*` (the AWS-managed CMK scope) but the parameter does not actually use that CMK.
4. The placeholders are "change-me-on-first-deploy" strings today, but PR 4 + the operations runbook rotate real secrets into these parameters. As-is, those real secrets land in plaintext SSM at deploy time. That is the entire threat model for `runbook/rotate-admin-password.md` (RISK-W04 follow-up) — and the runbook is wasted if the parameter is plaintext.

**Concrete fix:**

In both `ApiStack.ts:115-128` and `jwt-secret.ts:32-42`, add `type: ssm.ParameterType.SECURE_STRING` to each `StringParameter` constructor. Then re-run `cdk synth --all` and confirm the CFN template shows `"Type": "SecureString"`. Also add a one-line assertion to `packages/infra/test/constructs/api-stack.test.ts` (the test file already exists) that the synthesized template JSON contains `"SecureString"` for the JWT parameters.

---

### C2 — Database URL with resolved password stored as plaintext SSM. **BLOCKER.**

**File:** `packages/infra/src/stacks/DatabaseStack.ts:135-142`

**Evidence — code:**

```ts
const databaseUrlParameter = new ssm.StringParameter(this, 'DatabaseUrlParameter', {
  parameterName: `/MercadoExpress/${stage}/database-url`,
  stringValue: `postgresql://mercadoexpress_admin:{{resolve:secretsmanager:${credentials.secretName}}}@${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}/mercadoexpress`,
  description: `MercadoExpress ${stage} DATABASE_URL template. The {{resolve:secretsmanager:...}} placeholder is resolved at Lambda cold start by SSM.`,
});
```

**Evidence — synthesized CFN:**

```json
"DatabaseUrlParameterD3248738": {
  "Type": "AWS::SSM::Parameter",
  "Properties": {
    "Type": "String",
    "Value": { "Fn::Join": [ "", [ ... "resolve:secretsmanager:..." ... ] ] }
  }
}
```

`{{resolve:secretsmanager:...}}` is a **CloudFormation** dynamic reference. CFN evaluates it at deploy time and substitutes the literal secret value from Secrets Manager into the SSM parameter's `Value`. The result is stored as a plaintext `String` (not `SecureString`) in SSM. The actual RDS master password is therefore readable by any principal with `ssm:GetParameter` on `/MercadoExpress/{stage}/database-url`.

(The inline comment "The {{resolve:secretsmanager:...}} placeholder is resolved at Lambda cold start by SSM" is also wrong — there is no such runtime resolution mechanism for `String` SSM parameters from a Lambda env var. Lambdas have to call `GetParameter` at cold start to read it. The current code in `ApiStack.ts:140` sets the Lambda env var `DATABASE_URL: databaseUrlSecretArn` (the SSM ARN), and the future PR-2a Lambda code will need to call `GetParameter` to materialize it.)

**Why it matters:**

The whole point of using `Credentials.fromGeneratedSecret('mercadoexpress_admin', { ... })` is to keep the password in Secrets Manager, never in code or env vars. By using a `String` SSM parameter as the URL carrier, the design accidentally copies the secret into SSM in plaintext at deploy time. That is the same risk as the JWT secret (C1) and a larger blast radius because the DB password grants full DDL/DML on the production database.

**Concrete fix:**

Add `type: ssm.ParameterType.SECURE_STRING` to the `StringParameter` constructor at `DatabaseStack.ts:137`. SecureString parameters are allowed to embed `{{resolve:secretsmanager:...}}` and the result is encrypted with the AWS-managed CMK. The migrations Lambda already has `kms:Decrypt` permission (which is correct in shape, just applied to the wrong parameter at PR 1's pre-fix state). The PR 2a Lambda will need to call `ssm:GetParameter` (no `kms:Decrypt` change required) and unmarshal the URL itself.

Also correct the inline comment — the resolution happens at CFN deploy time, not at Lambda cold start.

---

### C3 — Hardcoded `ADMIN_PASSWORD` literal baked into the migrations Lambda env. **BLOCKER.**

**File:** `packages/infra/src/constructs/migrations.ts:50`

**Evidence:**

```ts
environment: {
  STAGE: stage,
  DATABASE_URL: databaseUrlSecretArn,
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@mercadoexpress.local',
  ADMIN_PASSWORD: 'change-me-on-first-deploy',
},
```

**Why it matters:**

`Lambda.Environment` is rendered into the CFN template as plaintext. The synthesized CFN for the migrations function would contain the literal string `change-me-on-first-deploy` as the `ADMIN_PASSWORD` environment variable. This pattern:

1. Is inconsistent with the design (which places the JWT secret in SSM and the DB password in Secrets Manager).
2. Becomes a real risk the moment PR 2a swaps `'change-me-on-first-deploy'` for a real password. The CFN template would then carry the live admin password in plaintext, visible to anyone with `cloudformation:DescribeStackResource` on the DatabaseStack.
3. Even with the placeholder, it sets a wrong precedent: future BCs that need bootstrap passwords (e.g. a `GROQ_API_KEY` for the AI adapter) might copy this pattern.

The literal string is also one of the user's red-flag patterns (`password=`, `ADMIN_PASSWORD`) per the security checklist, and would show up in any `git log -p` history scan.

**Concrete fix:**

Add a third SSM `SecureString` parameter `/MercadoExpress/{stage}/admin-password` (parallel to the JWT secret pair), with `type: ssm.ParameterType.SECURE_STRING` and a placeholder value. Wire the migrations Lambda env to read `process.env.ADMIN_PASSWORD` from SSM at cold start (same pattern as the JWT secret is supposed to be — see C1). The placeholder can stay `change-me-on-first-deploy` for PR 1, but it must live in SSM, not in the CFN template.

---

## Findings — SUGGESTION

### S1 — `addAlarmAction` uses an `as never` cast instead of `SnsAction`

**File:** `packages/infra/src/stacks/ObservabilityStack.ts:76, 92, 113` (3 occurrences)

**Evidence:**

```ts
}).addAlarmAction({ bind: () => ({ alarmActionArn: this.alarmTopic.topicArn }) } as never);
```

**Why it matters:** The proper CDK pattern is `import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'` and `.addAlarmAction(new SnsAction(this.alarmTopic))`. The `as never` cast hides a type mismatch and is brittle to CDK upgrades — if the `IAlarmAction` interface gains a required method, the cast will not catch the regression. The 3 repetitions × 3 alarm types = 9 cast instances is also a maintenance cost. SUGGESTION — works at runtime, but inconsistent with CDK idioms and the rest of the file (which already imports `aws-cdk-lib/aws-sns`).

### S2 — `pnpm.overrides.tar` is a semver range, not a fixed version

**File:** `package.json:13`

**Evidence:** `"tar": "^7.5.11"`.

**Why it matters:** The user's checklist #6 says "fixed version, not a vulnerable range". `^7.5.11` resolves to `>= 7.5.11 < 8.0.0`. It is bounded (no vulnerable versions included) but it is still a range. The apply-progress §8 already documents that the resolved version is `7.5.19`; pinning to that exact version (`"tar": "7.5.19"`) makes the override intent explicit and prevents a future `7.5.20` regression from sneaking in. SUGGESTION-level (not blocker) because the CI audit (`pnpm audit --prod --audit-level=high`) gates the merge.

### S3 — Five near-identical `bootstrap.ts` files (duplication)

**Files:**

- `packages/backend/src/auth/interface/handlers/bootstrap.ts`
- `packages/backend/src/products/interface/handlers/bootstrap.ts`
- `packages/backend/src/inventory/interface/handlers/bootstrap.ts`
- `packages/backend/src/alerts/interface/handlers/bootstrap.ts`
- `packages/backend/src/orders/interface/handlers/bootstrap.ts`

**Evidence:** All 5 files have the same body, differing only in the `bc: '<name>'` string and the exported interface name:

```ts
export function bootstrapProducts(): ProductsBootstrap {
  return {
    prisma: getPrismaClient(),
    logger: createLogger().child({ bc: 'products' }),
  };
}
```

**Why it matters:** Duplicated logic is one of the readability review rules. A single factory `bootstrapBc(name: BcName): BcBootstrap` (or a generic `createBootstrap(bc: string)`) would collapse 5 files × 20 lines into one file × 10 lines + a 1-line import per BC. The per-BC interface names (e.g. `AuthBootstrap`, `ProductsBootstrap`) also do not add information — they are all the same shape. SUGGESTION — five files of 20 lines is below the threshold where duplication becomes a real maintenance burden, but if PR 2a/2b/2c add fields to the bootstrap (e.g. a feature flag reader, a rate limiter, a clock), the 5-way copy will start to drift.

### S4 — `BACKEND_PACKAGE_VERSION` not bumped to `pr1`

**File:** `packages/backend/src/index.ts:10`

**Evidence:** `export const BACKEND_PACKAGE_VERSION = '0.0.0-pr0';` (compare to `packages/infra/src/app.ts:22` which was updated to `'0.0.0-pr1'`).

**Why it matters:** Minor inconsistency. The infra package was versioned; the backend package was not. PR 1's apply-progress §1 task 5 (line 257) does not list `index.ts` under the backend changes. SUGGESTION — bump to `'0.0.0-pr1'` in a small follow-up.

### S5 — `kms:Decrypt` grant on `*` for the migrations Lambda

**File:** `packages/infra/src/constructs/migrations.ts:64-71`

**Evidence:**

```ts
migrationsFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['kms:Decrypt'],
    // AWS-managed CMK for SSM SecureString — `*` is the documented
    // scope for `alias/aws/ssm`.
    resources: ['*'],
  }),
);
```

**Why it matters:** Once C1 + C2 are fixed, the migrations Lambda will be reading multiple `SecureString` parameters. `resources: ['*']` works (it is the documented scope for the AWS-managed CMK because the alias resolves to an account-wide ARN), but the principle of least privilege suggests scoping to the specific CMK ARN. SUGGESTION — replace with the CMK ARN pattern `arn:aws:kms:${region}:${account}:alias/aws/ssm` (the actual values come from `Stack.of(this).account` + region). The `*` form is a minor audit smell, not a security defect (no AWS principal can decrypt without also having `kms:Decrypt` on the specific CMK they target, and the AWS-managed CMK is already account-public).

### S6 — FrontendStack ResponseHeadersPolicy omits Content-Security-Policy

**File:** `packages/infra/src/stacks/FrontendStack.ts:50-69`

**Evidence:** The `securityHeadersBehavior` block sets `contentTypeOptions`, `frameOptions`, `referrerPolicy`, and `strictTransportSecurity`, but not `contentSecurityPolicy`. The inline comment says "CSP itself is delivered via index.html (PR 3)".

**Why it matters:** The user's checklist #4 explicitly asks to verify CSP in the response headers policy. The design's RISK-W01 fix actually allows EITHER approach (a `Content-Security-Policy` response header OR an `index.html` `<meta http-equiv="Content-Security-Policy">`), so the implementation is defensible per the design — but the user's checklist is stricter. SUGGESTION — add a `contentSecurityPolicy` entry to the response headers policy now (a 1-line `contentSecurityPolicy: { contentSecurityPolicy: "default-src 'self'; ...", override: true }`) so the SPA is protected even before PR 3 lands the index.html, and so the user's checklist is satisfied. The recommended CSP is already drafted in `risk-review.md RISK-W01`.

### S7 — `MigrationsCustomResource` is dead code in PR 1

**File:** `packages/infra/src/constructs/migrations.ts:21-79`

**Evidence:** `MigrationsCustomResource` is exported but no stack instantiates it (`grep -r "new MigrationsCustomResource" packages/infra/src` returns nothing). The migrations Lambda is therefore not deployed in the current synth; the seed never runs.

**Why it matters:** The migrations construct is an island. Either PR 1 should wire it into the ApiStack (or a new `MigrationsStack`) so the migrations actually run on stack create, or it should be deferred to PR 2a (where the Prisma schema ships) and the `migrations.ts`, `migrations-lambda.ts`, `seed.ts` files should be moved out of the PR 1 deliverable. Leaving it as dead code means the next reviewer has to re-derive the intent from comments. SUGGESTION — the apply-progress already says the construct is the wiring for PR 2a, but the file is committed in PR 1 and reviewers will look at it. Either add a one-line `// NOT WIRED IN PR 1; instantiated by ApiStack in PR 2a when the Prisma schema lands.` at the top, or move the files.

### S8 — `JwtSecretPair` is dead code in PR 1 (same pattern as S7)

**File:** `packages/infra/src/constructs/jwt-secret.ts:1-44`

**Evidence:** `JwtSecretPair` is exported but `grep -r "new JwtSecretPair" packages/infra/src` returns nothing. The actual JWT secret wiring is in `ApiStack.ts:115-128` and uses its own `ssm.StringParameter` pair. `jwt-secret.ts` is a duplicate of the same construct logic.

**Why it matters:** Two files constructing the same pair of SSM parameters is a divergence waiting to happen — PR 2a may fix one and forget the other. Either delete `jwt-secret.ts` (it has no consumer) or move the SSM parameter construction out of `ApiStack.ts` into `jwt-secret.ts` and have `ApiStack` import it. The current state — "we have two ways to do the same thing, neither of them SecureString" — is a maintenance trap.

---

## Findings — NIT

### N1 — `synth.test.ts` comment about `--all` is factually wrong

**File:** `packages/infra/test/synth.test.ts:13-14`

**Evidence:**

```ts
// CDK 2.112+ no longer ships `--all`, so we iterate per stage.
```

But `cdk synth --all` is still supported in CDK 2.155+ (this project pins `^2.155.0`). The apply-progress §4 verification-gate output shows `cdk synth --all --no-color` succeeding and synthesizing 8 templates. The comment either confuses `--all` with some other flag, or refers to a real but unrelated CDK 2.112 change. Either way, the comment misleads the next maintainer.

### N2 — `placeholder-entry.ts` is not actually gitignored

**File:** `packages/infra/src/stacks/ApiStack.ts:155-156`

**Evidence:** The comment claims "The file is gitignored under the build artifact category (it's a working stub)." `git check-ignore packages/infra/placeholder-entry.ts` returns empty — the file is committed (commit `17ad4bd` "test(infra): green CDK construct tests after construct wiring").

**Why it matters:** Misleading comment. It is correct that the placeholder will be replaced in PR 2a, but the file is on disk and tracked in git. Trim the sentence.

### N3 — Carry-over from PR 0 review S2: `type-check` still bypasses frontend `vue-tsc`

**File:** `package.json:18` (root)

**Evidence:** `"type-check": "pnpm -r --workspace-concurrency=1 exec tsc --noEmit"` — same as PR 0.

**Why it matters:** The PR 0 review's S2 suggested switching the root script to `pnpm -r --workspace-concurrency=1 type-check` so it dispatches to each package's own `type-check` script (which is `vue-tsc --noEmit` for the frontend). PR 1 did not address this. It is not a PR 1 regression — it is a carry-over. Mentioning here for completeness so the chain does not lose the signal; the user's instructions say "skim it so you don't re-flag PR 0 issues" but a 2-line fix that lives at root is worth closing before PR 3 ships Vue SFCs.

### N4 — `void infraConfig;` and `void runCommand;` are dead references to keep imports

**Files:**

- `packages/infra/src/stacks/FrontendStack.ts:104` — `void infraConfig;`
- `packages/infra/src/constructs/migrations-lambda.ts:62` — `void runCommand;`

**Why it matters:** Both use a `void` statement to silence the "unused import" warning. This is a common workaround for the ESLint `no-unused-vars` rule but it leaves a confusing line in the source. Better alternatives: (a) the `eslint-disable-next-line @typescript-eslint/no-unused-vars` annotation, (b) a `@ts-expect-error` directive, or (c) actually consume the value (e.g. attach a project-wide tag in `FrontendStack` via `Tags.of(this).add(...)`). NIT — this is an established pattern across the codebase; the PR 1 files just follow it.

### N5 — Bootstrap BC names are strings, not a typed union

**File:** `packages/backend/src/shared/logger.ts:25` (`bc: string`); the 5 bootstrap files use string literals `'auth'`, `'products'`, etc.

**Why it matters:** A typo in one of the 5 files (e.g. `'aut'` instead of `'auth'`) would silently produce a different `bc` value in CloudWatch logs and defeat the dashboard grouping. A `type BcName = 'auth' | 'products' | 'inventory' | 'alerts' | 'orders'` and a typed `bc: BcName` field in `MandatoryFields` would let TypeScript catch typos at compile time. NIT — five literal strings is below the threshold where this would normally be flagged, but it is a 1-line type alias that the next BC can extend.

---

## Verification

I read every file in the user's "What to review" list, plus the supporting context:

**Infra (`packages/infra/src/`):**

- `app.ts`, `config.ts`
- `stacks/DatabaseStack.ts`, `stacks/FrontendStack.ts`, `stacks/ApiStack.ts`, `stacks/ObservabilityStack.ts`
- `constructs/jwt-secret.ts`, `constructs/migrations.ts`, `constructs/migrations-lambda.ts`, `constructs/seed.ts`
- `placeholder-entry.ts`
- `cdk.json`, `cdk.context.json`, `cdk.out/*.template.json` (read 4 of the 8 templates to confirm the `Type: "String"` issue on the JWT + DB URL parameters), `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- `test/synth.test.ts`, `test/setup.global.ts`
- `test/constructs/{api-stack, database-stack, frontend-stack, observability-stack}.test.ts`

**Backend (`packages/backend/src/`):**

- All 10 files in `shared/` (`api-error.ts`, `error-mapper.ts`, `extract-client-ip.ts`, `health.ts`, `idempotency-key.ts`, `jwt-middleware.ts`, `logger.ts`, `prisma-client.ts`, `rate-limit-error.ts`, `request-context.ts`)
- All 2 files in `shared/errors/` (`base-domain-error.ts`, `typed-errors.ts`)
- All 10 handler files in `auth/`, `products/`, `inventory/`, `alerts/`, `orders/interface/handlers/` (5 `bootstrap.ts` + 5 `{action}.ts`)
- All 5 test files in `test/shared/`
- `index.ts`, `package.json`, `.env.example`

**CI (`.github/`):**

- `workflows/ci.yml`, `workflows/deploy-dev.yml`
- `dependabot.yml`

**Root:**

- `package.json` (including `pnpm.overrides`)
- `.env.example` (root)
- `README.md`
- `.gitignore`
- `openspec/changes/add-inventory-mvp/apply-progress.md` (PR 1 section, lines 239–569)

**Re-grepped for hardcoded secrets** (case-insensitive, regex):

```
grep -rniE "(password=|secret=|api_key|Bearer |AKIA|sk-|aws_secret_access_key)" \
  packages/infra/src packages/infra/placeholder-entry.ts packages/infra/test \
  packages/infra/cdk.json packages/infra/cdk.context.json \
  packages/backend/src packages/backend/test .github
```

Returns only comments and the `Bearer` token literal in `jwt-middleware.ts:120` (which is the expected parse of the `Authorization: Bearer <token>` header) and `'change-me-on-first-deploy'` in `migrations.ts:50` (covered by C3). No AWS access keys, no `sk-` API keys, no hex-encoded blobs, no `.env` literals.

**CDK synth re-validation:**

- `cdk synth --all` succeeds for both `dev` and `prod` (8 templates total).
- Synthesized templates contain `"Type": "String"` (not `"SecureString"`) for `/MercadoExpress/{stage}/jwt-secret`, `/MercadoExpress/{stage}/jwt-secret-previous`, and `/MercadoExpress/{stage}/database-url` — these are the source of C1 and C2.
- The 5 `AuthLambda`/`ProductsLambda`/`InventoryLambda`/`AlertsLambda`/`OrdersLambda` resources are present in the ApiStack template with `RetentionInDays: 7` log groups and `ReservedConcurrentExecutions: 1` in the dev template.
- No `Annotations.addWarningV2` (real warnings) in the metadata files — the only `addWarningV2` references in the metadata are the [ack:] feature-flag acknowledgments, which are not warnings.

**Skill resolution:** `skill_resolution: none` per the user's instructions.

---

## Decision

**BLOCK.**

The three CRITICAL findings (C1, C2, C3) are all the same class of defect — secret material rendered into a CFN template in plaintext — and they are all easy to fix:

- C1: add `type: ssm.ParameterType.SECURE_STRING` to two `StringParameter` constructors in `ApiStack.ts` and `jwt-secret.ts`.
- C2: add the same `type` to the `StringParameter` in `DatabaseStack.ts:137`. Correct the inline comment about "Lambda cold start" resolution.
- C3: move the `ADMIN_PASSWORD` literal into a `SecureString` SSM parameter and wire the migrations Lambda to read it.

The user's checklist explicitly asks for each of these and they are not currently met. PR 0 review's "APPROVE-WITH-SUGGESTIONS" was a foundation slice; PR 1 is the slice that creates the actual AWS resources, and the first deploy would commit plaintext JWT and DB credentials to SSM. That is the worst possible time to discover the defect.

The SUGGESTION items (S1–S8) are not blockers; they should be addressed in a follow-up commit or in PR 2a. S1 (the `as never` cast) is the most valuable because it touches 3 lines × 3 alarm types. S2–S8 are stylistic and structural cleanups.

The NIT items (N1–N5) are documentation drift. N1 (the `synth.test.ts` comment) and N2 (the `placeholder-entry.ts` "gitignored" claim) should be trimmed before PR 2a lands so the next reviewer does not propagate the wrong information.

If the user wants to close C1, C2, and C3 in a single follow-up commit (3 files, ~6 lines of change), PR 1 can ship. The SUGGESTIONs can ride along in the same commit or wait for PR 2a.

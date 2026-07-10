# PR 1 BLOCKER Re-Review — MercadoExpress

- **Reviewer:** review-readability (subagent, fresh context)
- **Timestamp:** 2026-07-10
- **Scope:** PR 1 closeout commits `a08437e..aa34da9` (4 commits, BLOCKER closeout only)
- **Out of scope:** the rest of PR 1 (`b3bcf6b..6561e2b`) and the 8 SUGGESTION + 5 NIT items from the prior review (S1–S8, N1–N5) — those are tracked for the PR 4 review-cleanup per `apply-progress.md` §"Findings deliberately out of scope".
- **Prior review:** `openspec/changes/add-inventory-mvp/reviews/pr1-readability-review.md` (3 BLOCKERs: C1, C2, C3).
- **Verification re-run:** `pnpm exec vitest run` from `packages/infra` → **18/18 tests pass, 5 files, ~12.8s**, including the `synth.test.ts` smoke test which shells out to `cdk synth -c stage=dev` and `cdk synth -c stage=prod` (both exit 0). Synthesized CFN in `packages/infra/cdk.out/*.template.json` re-inspected.

## C1 re-verification

**Confirmed.**

**Code — `ApiStack.ts:115-129` (current state):**

```ts
// JWT secrets — the dual-secret rotation window requires both
// `JWT_SECRET` and `JWT_SECRET_PREVIOUS` to live in SSM Parameter
// Store as SecureStrings (encrypted at rest with the AWS-managed
// CMK `alias/aws/ssm`). Initial values are placeholders; the
// operations runbook rotates them.
const jwtSecret = new ssm.StringParameter(this, 'JwtSecret', {
  parameterName: `/MercadoExpress/${stage}/jwt-secret`,
  stringValue: 'placeholder-replaced-by-ops',
  description: `MercadoExpress ${stage} JWT secret (HS256). Replace via the rotate-admin-password runbook.`,
  type: ssm.ParameterType.SECURE_STRING, // <-- added
});
const jwtSecretPrevious = new ssm.StringParameter(this, 'JwtSecretPrevious', {
  parameterName: `/MercadoExpress/${stage}/jwt-secret-previous`,
  stringValue: 'placeholder-empty-on-first-deploy',
  description: `MercadoExpress ${stage} JWT previous secret (HS256) — used during the rotation overlap window.`,
  type: ssm.ParameterType.SECURE_STRING, // <-- added
});
```

**Code — `jwt-secret.ts:32-42` (current state):**

```ts
this.current = new ssm.StringParameter(this, 'Current', {
  parameterName: `/MercadoExpress/${stage}/jwt-secret`,
  stringValue: 'placeholder-replaced-by-ops',
  description: `MercadoExpress ${stage} JWT HS256 secret (current). Rotate via runbook/rotate-admin-password.md.`,
  type: ssm.ParameterType.SECURE_STRING, // <-- added
});

this.previous = new ssm.StringParameter(this, 'Previous', {
  parameterName: `/MercadoExpress/${stage}/jwt-secret-previous`,
  stringValue: 'placeholder-empty-on-first-deploy',
  description: `MercadoExpress ${stage} JWT HS256 secret (previous). Set when rotating via the runbook; cleared after the overlap window.`,
  type: ssm.ParameterType.SECURE_STRING, // <-- added
});
```

**Synthesized CFN — `packages/infra/cdk.out/MercadoExpress-dev-Api.template.json:435-456`:**

```json
"JwtSecretB8834B39": {
 "Type": "AWS::SSM::Parameter",
 "Properties": {
  "Description": "MercadoExpress dev JWT secret (HS256). Replace via the rotate-admin-password runbook.",
  "Name": "/MercadoExpress/dev/jwt-secret",
  "Type": "SecureString",                        // <-- was "String" pre-fix
  "Value": "placeholder-replaced-by-ops"
 }
},
"JwtSecretPrevious3D6C4854": {
 "Type": "AWS::SSM::Parameter",
 "Properties": {
  "Description": "MercadoExpress dev JWT previous secret (HS256) — used during the rotation overlap window.",
  "Name": "/MercadoExpress/dev/jwt-secret-previous",
  "Type": "SecureString",                        // <-- was "String" pre-fix
  "Value": "placeholder-empty-on-first-deploy"
 }
}
```

Same shape in `MercadoExpress-prod-Api.template.json:435-456` (both `Type: SecureString`).

**Aggregate grep across the 4 synthesized templates:**

```
$ grep -c '"Type": "String"'  .../*-{Api,Database}.template.json
0  (all four templates)

$ grep -c '"Type": "SecureString"'  .../*-{Api,Database}.template.json
2  Api (dev + prod):  jwt-secret, jwt-secret-previous
1  Database (dev + prod):  admin-password
```

The plaintext `String` SSM parameter class is gone for every secret in the project.

## C2 re-verification

**Confirmed.** Approach chosen: **Option A** (explicit `rds.DatabaseSecret`, secret ARN in env, Lambda calls `GetSecretValue` at cold start).

**Code — `DatabaseStack.ts` (current state):**

- `ssm` import dropped from the SSM-URL block; new `import * as rds from 'aws-cdk-lib/aws-rds'` + `import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'` (lines 25, 28).
- Lines 90-103: `rds.DatabaseSecret` provisioned; `Credentials.fromSecret(dbSecret as unknown as secretsmanager.ISecret, 'mercadoexpress_admin')` wires the auto-rotated secret into the RDS instance. (Inline comment explains the `unknown`-cast as a documented CDK type-system gap for `rds.DatabaseSecret.secretFullArn` vs `ISecret.secretFullArn` — defensible.)
- Lines 168-170: `this.databaseUrlSecretArn = dbSecret.secretArn;` — the field consumed downstream is now the **Secrets Manager secret ARN**, not an SSM parameter ARN. Field name kept for downstream-API compatibility; semantic meaning has changed (documented in the updated JSDoc on lines 41-43).
- Lines 172-178: `CfnOutput` renamed `DatabaseUrlSecretArn` → `DatabaseSecretArn`; export renamed `MercadoExpress-{stage}-DatabaseUrlSecretArn` → `MercadoExpress-{stage}-DatabaseSecretArn`.
- The old `databaseUrlParameter` `ssm.StringParameter` constructor is removed entirely.

**Code — `migrations.ts:55-72` (current state):**

```ts
migrationsFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['secretsmanager:GetSecretValue'], // <-- was ssm:GetParameter
    resources: [databaseUrlSecretArn], // <-- the Secrets Manager ARN
  }),
);
```

The env var block is unchanged in shape — it still carries `DATABASE_URL: databaseUrlSecretArn` — but the value is now a string ARN that the Lambda will resolve at cold start via the AWS SDK (PR 2a task per the prior review's design.md §10.4 wiring).

**Synthesized CFN — `packages/infra/cdk.out/MercadoExpress-dev-Database.template.json:236-280`:**

```json
"DbSecret685A0FA5": {
 "Type": "AWS::SecretsManager::Secret",         // <-- new, not "AWS::SSM::Parameter"
 ...
},
"DbSecretAttachment0609CE05": {
 "Type": "AWS::SecretsManager::SecretTargetAttachment",
 "Properties": {
  "SecretId": { "Ref": "DbSecret685A0FA5" },
  "TargetId": { "Ref": "Postgres..." }
 }
}
```

**Synthesized CFN — `DatabaseSecretArn` output (lines 393-401):**

```json
"DatabaseSecretArn": {
 "Description": "Secrets Manager ARN carrying the DB master credentials JSON. Lambdas call GetSecretValue at cold start to materialize DATABASE_URL.",
 "Value": { "Ref": "DbSecret685A0FA5" },         // <-- Secrets Manager ref, not a string literal
 "Export": { "Name": "MercadoExpress-dev-DatabaseSecretArn" }
}
```

**Aggregate grep — old parameter name is fully removed:**

```
$ grep -rn "database-url\|DatabaseUrlParameter\|/database-url" packages/infra/cdk.out/ packages/infra/src/
(no output, exit 1)
```

The prior SSM `String` parameter `database-url` and its dynamic reference do not appear in any synthesized template or in any source file. The construct test at `packages/infra/test/constructs/database-stack.test.ts:65-71` now asserts exactly this: it expects `DatabaseSecretArn` to be defined AND `templateStr` not to match `/\/database-url/` AND `templateStr` to contain `AWS::SecretsManager::Secret`.

## C3 re-verification

**Confirmed (with a known caveat — see "Caveats" below).**

**Code — `migrations.ts:42-59` (current state):**

```ts
export interface MigrationsCustomResourceProps {
  stage: Stage;
  databaseUrlSecretArn: string;
  /** Name of the SSM SecureString parameter carrying the admin bootstrap password. */
  adminPasswordParameterName: string;           // <-- new prop
}

// …inside the NodejsFunction env block:
environment: {
  STAGE: stage,
  DATABASE_URL: databaseUrlSecretArn,
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@mercadoexpress.local',
  // PR 1 review BLOCKER C3: pull the admin password from the SSM
  // SecureString parameter at cold start — never bake a literal into
  // the CFN env-var block (synthesized CFN previously carried
  // 'change-me-on-first-deploy' as plaintext).
  ADMIN_PASSWORD: ssm.StringParameter.valueForStringParameter(  // <-- was 'change-me-on-first-deploy'
    this,
    adminPasswordParameterName,
  ),
},
```

The literal `'change-me-on-first-deploy'` no longer appears in any env-var block. The string is still present once in a code comment on `migrations.ts:56` (the explanatory comment that references it as historical context). Comments are not rendered into the synthesized CFN — confirmed by the grep below.

**Code — `migrations.ts:73-87` (new IAM policy):**

```ts
const adminPasswordParameterArn = ssm.StringParameter.fromStringParameterName(
  this,
  'AdminPasswordParameterRef',
  adminPasswordParameterName,
).parameterArn;
migrationsFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ssm:GetParameter', 'ssm:GetParameters'],
    resources: [adminPasswordParameterArn], // <-- scoped, not '*'
  }),
);
```

Plus the existing `kms:Decrypt` on `*` (kept — covers the AWS-managed CMK `alias/aws/ssm`; tracked as S5 from prior review, deferred to PR 4 review-cleanup).

**Code — `DatabaseStack.ts:156-170` (new parameter, current state):**

```ts
const adminPasswordParameter = new ssm.StringParameter(this, 'AdminPasswordParameter', {
  parameterName: `/MercadoExpress/${stage}/admin-password`,
  stringValue: 'placeholder-replaced-by-ops',
  description: `MercadoExpress ${stage} admin (usuario seed) bootstrap password. Rotate via runbook/rotate-admin-password.md.`,
  type: ssm.ParameterType.SECURE_STRING, // <-- SecureString
});
this.adminPasswordParameterName = adminPasswordParameter.parameterName;
```

**Synthesized CFN — `packages/infra/cdk.out/MercadoExpress-dev-Database.template.json:370-380`:**

```json
"AdminPasswordParameter0C53F9A1": {
 "Type": "AWS::SSM::Parameter",
 "Properties": {
  "Description": "MercadoExpress dev admin (usuario seed) bootstrap password. Rotate via runbook/rotate-admin-password.md.",
  "Name": "/MercadoExpress/dev/admin-password",
  "Type": "SecureString",                       // <-- not "String"
  "Value": "placeholder-replaced-by-ops"
 }
}
```

Same shape in `MercadoExpress-prod-Database.template.json:370-380`.

**Aggregate grep — literal is fully removed from CFN and source env-vars:**

```
$ grep -rln "change-me-on-first-deploy" packages/infra/cdk.out/
(no output, exit 1)

$ grep -n "change-me-on-first-deploy" packages/infra/src/constructs/migrations.ts
56:        // 'change-me-on-first-deploy' as plaintext).
```

The literal survives in exactly one place: a single historical-context comment in `migrations.ts:56` that explicitly documents what the prior code looked like so the next reader understands why the parameter exists. The synthesized CFN does not contain the string in any form, in any template, in either stage.

**Caveat (not a regression; pre-existing S7 from prior review):**

The MigrationsCustomResource is exported but not instantiated by any stack in PR 1 (`grep -rn "new MigrationsCustomResource" packages/infra/src` returns no matches). This means the migrations Lambda's `ADMIN_PASSWORD` env-var does not appear in the current `cdk.out/` — not because the wiring is wrong, but because the Lambda is dead code in PR 1 by design. The `ssm.StringParameter.valueForStringParameter(this, adminPasswordParameterName)` call is the standard CDK API that produces a `{{resolve:ssm:...}}` dynamic reference in CFN; tracing the call confirms the wiring is correct. PR 2a (per the prior review and the design.md §10.4 wiring) is the change that instantiates `new MigrationsCustomResource(this, 'Migrations', { stage, databaseUrlSecretArn, adminPasswordParameterName })` from the relevant stack. When PR 2a lands, the Lambda's env block will resolve `ADMIN_PASSWORD` to a CFN dynamic reference, not a literal string.

This is the same S7 finding the prior review documented — the closeout commits do not regress it (they add a required prop and wire the IAM policy correctly), and PR 2a is the proper home for instantiation.

## New issues found

### CRITICAL

None.

### WARNING

None.

### SUGGESTION

1. **`migrations.ts:56` — historical comment retains the literal `'change-me-on-first-deploy'`.** SUGGESTION. The string is in a comment, not in code, and does not appear in any synthesized CFN template (`grep -rln "change-me-on-first-deploy" packages/infra/cdk.out/` returns empty). The reason it survives is that the explanatory comment uses the literal as the historical reference. A defensive rewrite would be `… (synthesized CFN previously carried a placeholder admin password as plaintext) …` — same meaning, no literal string in the source. Not a blocker; the prior review's red-flag pattern was about literals in env-var blocks, and that defect is closed.

2. **`DatabaseStack.ts:96-100` — `as unknown as secretsmanager.ISecret` cast on `Credentials.fromSecret`.** SUGGESTION. The cast is a known CDK type-system gap (`rds.DatabaseSecret.secretFullArn` is `string | undefined` on the concrete class but `string` on the `ISecret` interface). The inline comment (lines 95-99) explains the why. The runtime object satisfies `ISecret`. Not a defect, but if a tighter approach is desired in the future, the project could (a) wrap with a tiny helper that returns `ISecret`, or (b) file an upstream CDK types-PR. Not a blocker for PR 1.

3. **S5 follow-up acknowledged but not addressed** — `migrations.ts:88-95` still uses `resources: ['*']` for `kms:Decrypt`. This is the same S5 from the prior review (carried over, not regressed). The closeout commits deliberately do not touch it; the new C3 wiring needs the AWS-managed CMK scope. Deferred to PR 4 review-cleanup per `apply-progress.md` §"Findings deliberately out of scope". Tracking only; no new defect.

### Hygiene check on the 4 commits

- **Atomicity:** ✓ each BLOCKER is a separate commit (`a08437e` = C1, `6fe034c` = C2, `83dc2f6` = C3, `aa34da9` = docs closeout). No mixing of concerns.
- **Conventional commit format:** ✓ `fix(infra): …` for the three fixes, `docs(apply): …` for the closeout record. Matches the project's `commitlint.config.cjs` shape.
- **No AI attribution:** ✓ `git log -1 --format='%(trailers:key=Co-authored-by,valueonly)'` returns empty for all 4 SHAs. Author is `Harri <harri@mercadoexpress.local>` on every commit.
- **No new hardcoded secrets introduced:** ✓ the new `stringValue: 'placeholder-replaced-by-ops'` on the admin-password parameter is a placeholder (intentionally so the operations runbook rotates a real value in); it is exactly the same shape and intent as the existing JWT pair placeholders, and it lives inside a `SecureString` parameter, not in CFN env-var plaintext. `ADMIN_USERNAME: 'admin'` and `ADMIN_EMAIL: 'admin@mercadoexpress.local'` are identifier strings, not authenticators.
- **No regression to CORS / OIDC / other security properties:** ✓ `git diff 6561e2b..aa34da9 -- packages/infra/src/stacks/ApiStack.ts` shows only the JWT SecureString additions (the only lines that change are 111-129, all inside the JWT secret block). `git diff` against `FrontendStack.ts` returns empty — the stack was not touched. The CORS preflight (RISK-002) is unchanged: `corsAllowOrigins = [`https://${distributionDomainName}`]` (line 82), 4 allow-headers, `allowCredentials: false` (line 96), `maxAge: 3600` (line 100). The RISK-002 OIDC / Cognito wiring remains a PR 2a task per the prior design and was not regressed.
- **Test coverage updated to match the fix:** ✓ `database-stack.test.ts:65-71` now asserts `DatabaseSecretArn` is defined, `templateStr` does not match `/\/database-url/`, and `templateStr` contains `AWS::SecretsManager::Secret`. These are the right assertions for the post-fix shape.
- **`apply-progress.md` closeout section complete:** ✓ `openspec/changes/add-inventory-mvp/apply-progress.md:572-714` documents C1, C2, C3 fix-by-fix with file/line references, chosen approach (Option A) and rationale, verification steps (synth + grep), and a verification-gate table. The deferred S1–S8 / N1–N5 list at the bottom is complete and matches the prior review's findings ledger.
- **`tasks.md` updated for the C2/C3 wiring change:** ✓ `openspec/changes/add-inventory-mvp/tasks.md:109` now reads `… reads the DB secret ARN from DATABASE_URL (Secrets Manager; PR 1 review BLOCKER C2 closeout) and the admin password from SSM SecureString /MercadoExpress/{stage}/admin-password (PR 1 review BLOCKER C3 closeout)`. One-line change, on the existing task entry, no scope creep.
- **`skill_resolution`:** `none` (per the user's instructions).

## Decision

**APPROVE.**

The 3 BLOCKERs are genuinely closed:

- C1: every JWT `ssm.StringParameter` (4 constructors across 2 files) now has `type: ssm.ParameterType.SECURE_STRING`. Synthesized CFN confirms `"Type": "SecureString"` for `JwtSecret` and `JwtSecretPrevious` in both `dev` and `prod`.
- C2: the old plaintext SSM `database-url` parameter is fully removed (zero matches in `cdk.out/` or `src/`). The DB credentials now live in an explicit `rds.DatabaseSecret` (`AWS::SecretsManager::Secret` in the CFN), and the migrations Lambda's policy switched from `ssm:GetParameter` to `secretsmanager:GetSecretValue` on the secret ARN.
- C3: the migrations Lambda env block no longer carries the literal `'change-me-on-first-deploy'` — replaced with `ssm.StringParameter.valueForStringParameter(...)` against a new SSM `SecureString` parameter `/MercadoExpress/{stage}/admin-password`. The literal survives only in one explanatory comment in `migrations.ts:56` and does not appear in any synthesized CFN template.

No new CRITICAL or WARNING issues were introduced. Three SUGGESTION items (S1' on the surviving comment literal, S2' on the `unknown`-cast, and the S5 follow-up for `kms:Decrypt` narrowing) are tracked but do not block PR 1 merge — they are the same scope tier as the prior review's 13 deferred items, all slated for PR 4 review-cleanup.

The 4 commits are atomic, conventional-commit formatted, AI-attribution-free, and add no new hardcoded secret material. The verification gate is green (18/18 tests pass, `cdk synth -c stage=dev` and `cdk synth -c stage=prod` both exit 0, no `String` SSM parameters carrying secret material in any of the 4 synthesized templates). PR 1 can ship.

`skill_resolution: none`.

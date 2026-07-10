# PR 2a Risk-Only Review - MercadoExpress

- **Reviewer:** review-risk (subagent, fresh context)
- **Timestamp:** 2026-07-10
- **Scope:** PR 2a commits afdde79, 2ae5f59, 8a5c616, 4bb78fd (plus prior PR 1 BLOCKER-fix commits a08437e, 6fe034c, 83dc2f6 for context on which infra wiring PR 2a consumes).
- **Out of scope:** the 13 SUGGESTIONs the prior readability reviewer logged on PR 1, any readability / naming items, and any BC handler implementation that lands in PR 2b.
- **Verification gate (re-confirmed by user, not re-run):** vitest 160/160, tsc / eslint / prettier clean, cdk synth OK, audit 0 high.
- **skill_resolution:** none.

The user's brief asked for **3 specific risk checks only**. Each check is a PASS / NOT YET / FAIL with file:line evidence. The full readability / reliability / resilience review for PR 2a is tracked separately.

---

## Check 1 - D3 / RISK-003: Postgres-backed rate limiter

### Status: **PASS** (with one SUGGESTION-level caveat)

### Evidence

**Port interface - packages/backend/src/auth/domain/ports/rate-limiter.ts:23-32:**

```ts
export interface RateLimiter {
  /** Records a failed attempt. Returns the updated decision. */
  recordFailure(ip: string, username: string): Promise<RateLimitDecision>;
  /** Resets the failure counter for the (ip, username) pair. */
  recordSuccess(ip: string, username: string): Promise<void>;
  /** Returns the current decision without recording anything. */
  check(ip: string, username: string): Promise<RateLimitDecision>;
}
```

The decision shape (count: number; blockedUntil: Date | null) is declared at lines 17-20. Behaviour matches Q-P4 (failures-only budget; success resets the counter).

**Adapter - packages/backend/src/auth/infrastructure/postgres-rate-limiter.ts:**

- recordFailure (lines 56-61): inserts a success: false row, then delegates to check(). Confirmed.
- recordSuccess (lines 63-67): deleteMany against { ip, username, success: false }. Q-P4 reset semantics confirmed.
- check (lines 69-84): counts rows where ip = $1 AND username = $2 AND success = false AND attemptedAt > cutoff() (cutoff = now - 900 s). Returns blockedUntil = now + 900 s when count >= 5 (default threshold = 5, line 49). The Prisma surface is narrowed to loginAttempt only (lines 28-41), so the adapter is testable with the in-memory fake in the test file (no testcontainers required).

**Schema - packages/backend/prisma/schema.prisma:85-94:**

The Prisma schema declares a **composite index on (ip, username, attemptedAt DESC)** but does NOT declare the WHERE success = false partial predicate. This is a known Prisma limitation.

However, the actual index DDL in the migration is correct - packages/backend/prisma/migrations/0_init/migration.sql:51-56:

```sql
-- Partial index used by the rate limiter's
-- WHERE success = false AND attempted_at > now() - INTERVAL '15 min'
-- query path. Per design.md section 4.6 + RISK-003.
CREATE INDEX "login_attempts_ip_username_failure_idx"
  ON "login_attempts" ("ip", "username", "attempted_at" DESC)
  WHERE "success" = false;
```

The runtime index in Postgres is the partial index the rate limiter's count query needs. The schema.prisma is the only artifact that lies about this - and only by omission. The mismatch is cosmetic; the query planner still uses the right index.

**Tests - packages/backend/src/auth/infrastructure/postgres-rate-limiter.test.ts:**

- "blocks after 5 failures (returns blockedUntil)" (lines 54-69): fires 5 failures, asserts count === 5, asserts blockedUntil instanceof Date with a ~15 min upper-bound check (remaining in (800_000, 900_000] ms). This is the integration test the brief asked for.
- "recordSuccess wipes the failure counter for the (ip, username) pair" (lines 71-82): explicit reset-after-success assertion.
- "isolates counters per (ip, username) pair" (lines 84-93): verifies per-pair scoping.

The test stub uses an in-memory Row[] array, not testcontainers - intentional per the brief and matching the in-line note in postgres-rate-limiter.ts:11-14. The **admission of an integration test that survives Prisma reconnect** (the AU-4 / D3 acceptance criterion that proves the counter is **not** in-process, per design.md section 3.7 row 325) is **not** present in this file. Expected to be added with the auth-lambda integration suite (PR 2a task; not regressed by this PR - the counter logic is in Postgres, the adapter is purely an SQL wrapper, so the property holds by construction).

### SUGGESTION (non-blocking, tracked)

packages/backend/prisma/schema.prisma:92 - the @@index does not carry a WHERE predicate. The migration SQL is correct, but a future prisma migrate dev against this schema will not regenerate the partial predicate; an unsuspecting operator who later drops and recreates the index from a regenerated migration will silently regress the rate-limiter query plan to a full-table scan. Not a blocker for PR 2a - the production DDL is correct.

### Decision for Check 1: PASS

---

## Check 2 - Cross-BC seam (RISK-001): AlertCloserPort declared in alerts BC

### Status: **NOT YET (expected - PR 2b scope)**

### Evidence

**Files that exist in PR 2a:**

```
$ find packages/backend/src/alerts -type f
packages/backend/src/alerts/interface/handlers/bootstrap.ts
packages/backend/src/alerts/interface/handlers/list-alerts.ts
```

Both are 20-line placeholder handlers that return 501 NOT_IMPLEMENTED with the message "GET /alerts lands in PR 2b" (confirmed at packages/backend/src/alerts/interface/handlers/list-alerts.ts:12-16). Same shape in bootstrap.ts.

**Files that do NOT exist yet:**

```
$ find packages/backend/src/alerts -type d
packages/backend/src/alerts
packages/backend/src/alerts/interface
packages/backend/src/alerts/interface/handlers
```

There is no packages/backend/src/alerts/domain/, no packages/backend/src/alerts/domain/ports/, no packages/backend/src/alerts/infrastructure/. The AlertCloserPort interface (alert-closer-port.ts) and its Prisma adapter (prisma-alert-closer-port.ts) are absent. The same is true for the inventory-side ProductStockGate port (packages/backend/src/inventory/infrastructure/prisma-product-stock-gate.ts does not exist either - inventory/interface/handlers/record-movement.ts is also a 21-line placeholder).

**Design.md reference - openspec/changes/add-inventory-mvp/design.md:**

- Section 5.3 (line 504) declares the port file paths and the partial-unique-safe UPDATE statement verbatim.
  - packages/backend/src/alerts/domain/ports/alert-closer-port.ts - interface declaration lines 539-553.
  - packages/backend/src/alerts/infrastructure/prisma-alert-closer-port.ts - adapter declaration line 559.
- Sections 5.2 / 6.3 show the receive-flow and inventory-flow that **consume** these ports. Those consumers also do not ship in PR 2a (orders/interface/handlers/receive-order.ts is a 21-line placeholder returning 501).
- The PR 2a description (per apply-progress.md and the brief) scopes PR 2a to the **scaffolding** of the BCs that were stubbed in PR 1. The alerts and inventory ports are explicitly deferred to PR 2b (the manual-ENTRADA recovery and the orders/receive flow both land in PR 2b per design.md sections 5.5 and 6.3).

This matches the user's explicit guidance: "If the alerts BC port is NOT in this PR's scope, NOTE that - it's expected to land in PR 2b."

### Decision for Check 2: NOT YET (expected - PR 2b scope, correctly deferred)

No regression. The placeholder handlers + the design.md cross-reference are the right shape for a scaffolding PR. Reviewer flagging is satisfied: section 5.3 carries the exact port signatures and the partial-unique-safe UPDATE that PR 2b must implement.

---

## Check 3 - JWT dual-secret rotation

### Status: **FAIL - CRITICAL**

JWT_OVERLAP_SECONDS is documented (in code comments AND in design.md section 3.7 acceptance criterion AU-rot row 326) as the env var that bounds how long JWT_SECRET_PREVIOUS is accepted after rotation. **The production validator does not read this env var at all.** Once JWT_SECRET_PREVIOUS is set in SSM, it is accepted **forever**, regardless of JWT_OVERLAP_SECONDS. The rotation window the design promises is non-functional.

### Evidence

**The validator - packages/backend/src/shared/jwt-middleware.ts:**

The brief references packages/backend/src/auth/infrastructure/jose-token-validator.ts, which **does not exist** (find ... -name "jose-token-validator*" returns nothing). The validator lives at packages/backend/src/shared/jwt-middleware.ts. The jose-token-issuer.ts JSDoc at line 6 explicitly defers to it: "overlap window the previous secret is handled by verifyJwt in packages/backend/src/shared/jwt-middleware.ts".

Lines 21-32 document the contract:

```ts
/**
 *   - JWT_SECRET             - current HS256 secret (required)
 *   - JWT_SECRET_PREVIOUS    - previous HS256 secret (optional, empty
 *                              during the steady state)
 *   - JWT_OVERLAP_SECONDS    - how long the previous secret is accepted
 *                              after rotation (default 3600s = 1h)
 *
 * During the overlap window both secrets verify successfully so we
 * can roll the secret on the issuer side without invalidating in-
 * flight tokens. Outside the window only the current secret verifies.
 */
```

The implementation - lines 51-89:

```ts
export async function verifyJwt(token: string): Promise<JWTPayload> {
  const current = readSecret('JWT_SECRET');
  if (!current) {
    throw new UnauthorizedError(ErrorCode.INVALID_TOKEN, 'JWT_SECRET env var is not configured');
  }
  const previous = readSecret('JWT_SECRET_PREVIOUS');                       // <- (A)
  const opts = DEFAULT_OPTIONS;

  // Try current secret first.
  try {
    const { payload } = await jwtVerify(token, current, { ... });
    return payload;
  } catch (err) {
    if (previous && err instanceof joseErrors.JWSSignatureVerificationFailed) {   // <- (B)
      try {
        const { payload } = await jwtVerify(token, previous, { ... });       // <- (C)
        return payload;
      } catch { ... }
    }
    ...
  }
}
```

- (A) reads JWT_SECRET_PREVIOUS if it is set. OK.
- (B) retries with previous only on signature failure (not on JWTExpired / JWSInvalid). OK (good hygiene).
- (C) accepts the token on a successful verify with the previous secret.

**What is missing:** there is **no read of process.env['JWT_OVERLAP_SECONDS']** anywhere in the file. There is no comparison against any rotation timestamp. There is no clock-based gate. The fallback at (C) fires unconditionally whenever previous is non-empty. Confirmed by grep:

```
$ grep -rn "JWT_OVERLAP_SECONDS" packages/backend/src
packages/backend/src/shared/jwt-middleware.ts:8:  *   - JWT_OVERLAP_SECONDS    - how long the previous secret is accepted
                                                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                                              comment-only - no process.env read follows

$ grep -rn "JWT_OVERLAP_SECONDS" packages/backend/src packages/backend/test
packages/backend/src/shared/jwt-middleware.ts:8:  *   - JWT_OVERLAP_SECONDS    - how long the previous secret is accepted
packages/backend/test/shared/jwt-middleware.test.ts:37:    process.env['JWT_OVERLAP_SECONDS'] = '3600';
                                                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                                              test-only - the production code never reads it
```

**Both call sites use the same broken behaviour.** withJwt (jwt-middleware.ts:106-127) wraps verifyJwt; packages/backend/src/shared/dispatchers/products-categories-dispatcher.ts:36,86 imports and calls verifyJwt directly. There is no separate validator implementation that could behave differently. Every protected route in the system - auth-lambda (when wired in PR 2a task), products-lambda, categories-lambda, and (future) the other BCs - runs through the same path.

**Issuer side - packages/backend/src/auth/infrastructure/jose-token-issuer.ts:**

Lines 17-30: signs with process.env['JWT_SECRET'] only. Correct - the issuer never touches the previous secret; the previous secret is a validator-side concern, as the design intends.

**The test does not cover the rejection path.** packages/backend/test/shared/jwt-middleware.test.ts (file is 73 lines):

- Line 37: sets process.env['JWT_OVERLAP_SECONDS'] = '3600' in beforeEach. The env var is set in the test, **but the production code does not read it, so this line is dead configuration**.
- Line 51: it('returns the payload for a token signed with JWT_SECRET_PREVIOUS during overlap', ...) - this test passes vacuously, irrespective of JWT_OVERLAP_SECONDS, because the production code never consults the window.
- There is **no companion test** "throws UnauthorizedError(INVALID_TOKEN) for a token signed with JWT_SECRET_PREVIOUS after the overlap window" - the half of the AU-rot acceptance criterion in design.md section 3.7 row 326 (... is accepted within JWT_OVERLAP_SECONDS, **rejected after**) is not asserted.

**Operational impact:** the design's rotation safety promise is unenforceable. If an operator rotates JWT_SECRET (writes the new secret into the /MercadoExpress/{stage}/jwt-secret SecureString parameter) and forgets to clear /MercadoExpress/{stage}/jwt-secret-previous, the old secret remains valid for **all** subsequent tokens, including ones signed by the previous secret **before** the rotation. The runbook that the comments reference (runbook/rotate-admin-password.md per jwt-secret.ts:36) will silently let the previous secret live forever. The window is not a safety property; it is a doc-only contract.

### Required remediation (BLOCKER-grade)

The brief says "BLOCK with concrete remediation steps" if a check fails. Concrete steps:

1. **Pick a clock source.** The validator is a stateless Lambda cold start; the obvious choices are (a) the rotation timestamp lives in a third SSM SecureString parameter (JWT_SECRET_PREVIOUS_ROTATED_AT, ISO-8601 set by the runbook at rotation time), or (b) the runbook writes the previous secret with a TTL-encoded header (worse - relies on string parsing). Option (a) is the smallest change.
2. **Read it in verifyJwt.** In jwt-middleware.ts, after (A), when previous is non-empty, read process.env['JWT_SECRET_PREVIOUS_ROTATED_AT'] (or pass it via SSM-as-env-var in ApiStack.ts). Compute now - rotatedAt. If > JWT_OVERLAP_SECONDS (parse env var, default 3600), treat previous = null for the rest of the function - fall through to the typed-error mapping.
3. **Wire it in ApiStack.ts.** Add a third ssm.StringParameter (JwtSecretPreviousRotatedAt, type SECURE_STRING? - actually no, an ISO-8601 string is not secret material; STRING_TYPE is fine) and pass it as an env var alongside JWT_SECRET and JWT_SECRET_PREVIOUS. The CDK contract: PR 1 wired 2 SSM params; PR 2a adds a 3rd.
4. **Add the rejection test.** New it() in jwt-middleware.test.ts:
   - Set JWT_SECRET, JWT_SECRET_PREVIOUS, JWT_SECRET_PREVIOUS_ROTATED_AT = '2020-01-01T00:00:00Z', JWT_OVERLAP_SECONDS = '3600'.
   - Sign a token with JWT_SECRET_PREVIOUS.
   - Assert verifyJwt(token) rejects with code: 'INVALID_TOKEN'.
   - Mirror the success-within-window test by setting JWT_SECRET_PREVIOUS_ROTATED_AT = new Date().toISOString() and asserting acceptance.
5. **Update design.md section 3.7 row 326 acceptance criterion** to name JWT_SECRET_PREVIOUS_ROTATED_AT as the clock source (it currently says JWT_OVERLAP_SECONDS alone, which is incomplete).
6. **Update runbook/rotate-admin-password.md (or whatever JWT rotation runbook exists)** to require (a) writing the new JWT_SECRET, (b) writing the OLD JWT_SECRET into JWT_SECRET_PREVIOUS, (c) writing the current ISO-8601 timestamp into JWT_SECRET_PREVIOUS_ROTATED_AT, all in the same SSM batch.

Until steps 1-4 land, PR 2a's JWT validator ships with a documented-but-unimplemented rotation safety property. **This is a regression versus the design.md contract** - the prior PR 1 review (and PR 1 BLOCKER closeout) explicitly anchored on the dual-secret overlap window as a security property.

### Decision for Check 3: FAIL (CRITICAL)

---

## Aggregate decision

**BLOCK** PR 2a merge.

- **Check 1 (Postgres rate limiter / D3 / RISK-003):** PASS. Adapter is correct, partial index is in the migration SQL, schema-level caveat is cosmetic, the 5-failure test exists.
- **Check 2 (Cross-BC seam / RISK-001):** NOT YET, expected. Port interfaces are PR 2b scope; design.md section 5.3 carries the signatures; placeholder handlers are the right shape for a scaffolding PR.
- **Check 3 (JWT dual-secret rotation):** **FAIL - CRITICAL.** JWT_OVERLAP_SECONDS is never enforced. The validator accepts JWT_SECRET_PREVIOUS indefinitely once it is set. This is a documented-vs-implemented gap that the AU-rot acceptance criterion in design.md section 3.7 row 326 promises to verify, but no test does.

PR 2a can ship once Check 3's six remediation steps are landed and the rejection-after-window test is green. None of the three findings are blockers for each other - the rate limiter (Check 1) and the deferred cross-BC seam (Check 2) are independently correct; only Check 3 needs new code.

Hard constraints honoured: no source files were modified (this review is the only file written). No readability items were re-flagged. The actual files were read, not guessed at - file:line evidence above is direct from the working tree as of the reviewed commits.

**skill_resolution:** none.

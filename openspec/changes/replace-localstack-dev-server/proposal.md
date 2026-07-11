# Proposal: replace-localstack-dev-server — native Node wrapper, drop CDK-in-LocalStack

**Status:** Draft for user review · **Phase:** sdd-propose · **Change folder:** `openspec/changes/replace-localstack-dev-server/`
**Supersedes:** `openspec/changes/add-localstack-dev-env/` (decision recorded below)

This proposal replaces the `docker/deployer/` CDK-in-LocalStack wrapper (which boots LocalStack 3.4 CE + cdk bootstrap + cdk deploy against it) with a native Node `http` server that directly invokes the real Lambda handlers over an `APIGatewayProxyEvent`-shaped request. LocalStack stays in compose but its SERVICES list shrinks to AWS-managed services it can actually simulate (S3, SQS, SNS, Secrets). The `LAMBDAS` route table that `ApiStack.ts` already exports is reused as the single source of truth — no parallel route mapping.

---

## Quick path (TL;DR)

- **The problem:** `docker/deployer/` runs `cdk bootstrap` + `cdk deploy` against LocalStack 3.4 CE. LocalStack Community simulates AWS-managed services (API Gateway, Lambda, S3, SQS, SNS, Secrets) but cannot simulate application services (the NodeJS Lambdas themselves, PostgREST). The result is a CDK-in-LocalStack loop that partially works and partially lies.
- **The fix:** a `scripts/dev-server.ts` (~150 LOC, `node:http` + `tsx`, zero new deps) that imports `LAMBDAS` from `@mercadoexpress/infra`, builds an `APIGatewayProxyEvent`, invokes the real handler, and writes the APIGW v2 response back to the client. One server, one source of truth for routes, same handler code as production.
- **What stays:** LocalStack container (S3/SQS/SNS/Secrets only), postgres, frontend, `docker-compose.dev.yml`. What goes: `docker/deployer/`, `docker/s3-proxy/`, `scripts/dev-up.sh`, `scripts/dev-down.sh`, the `deployer` and `s3-proxy` compose services, the `shared-data` volume, and the related env vars in `.env.dev*`.
- **Frontend fix:** `http.ts` drops the `?? 'http://localhost:3001/local'` fallback; base URL becomes `http://localhost:3001/api/v1`. The `/shared/.api-url` reader in `vite-env.ts` is removed because the shared volume is gone.
- **Next step:** Spec phase writes `dev-server.ts` responsibilities + route table contract; design phase chooses the `concurrently` runner and the localstack health gate.

---

## 1. Intent

LocalStack Community (`localstack/localstack:3.4`) is a full API emulator for AWS-managed services — `apigateway`, `lambda`, `s3`, `sqs`, `sns`, `secretsmanager`, `iam`, `sts`, `cloudformation`. What it cannot do is execute a real `NodejsFunction` bundle against that emulated API Gateway and produce the same handler invocation shape AWS does at the edge. Today the team hides that gap with two sidecars:

- `docker/deployer/` — a Node 20 + CDK container that runs `cdk bootstrap` + `cdk deploy --context stage=localstack` against the LocalStack endpoint. This is the official CDK path; it works when Lambda + API Gateway emulation cooperates and silently degrades (raw asset zips, cold-init failures, IAM-resolver quirks) when they don't.
- `docker/s3-proxy/` — an nginx reverse proxy in front of LocalStack's S3 so the frontend can reach `http://...:4566/<bucket>/<key>` style URLs without going through the AWS SDK's virtual-host addressing. This is a workaround for `AWS_ENDPOINT_URL_S3` resolution.

Two natures are mixed into one pipeline:

| Nature                   | Examples                                                                       | LocalStack CE simulates?                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **AWS-managed services** | API Gateway, Lambda, S3, SQS, SNS, Secrets                                     | Partially. `apigateway` + `lambda` works most of the time; `s3`/`sqs`/`sns`/`secrets` are reliable. |
| **Application services** | the NodeJS Lambda bundles themselves, the Prisma client they import, PostgREST | No. These are our code, not AWS APIs.                                                               |

`packages/infra/src/stacks/ApiStack.ts:60-127` already exports a `LAMBDAS: readonly LambdaSpec[]` constant — the same route table CDK uses to wire API Gateway routes in production. The wrapper just imports that constant, builds an `APIGatewayProxyEvent` per incoming HTTP request, calls the real `handler`, and writes the response back. There is no API Gateway emulation, no Lambda emulation, no asset upload; the request goes from `vite dev` straight into the handler through the same shape the real APIGW v2 produces.

LocalStack is **not removed**. It stays in `docker-compose.dev.yml` and continues to back any AWS-managed service the team decides to use in dev — S3 buckets, SQS queues, SNS topics, Secrets Manager values. What changes is the SERVICES list: `apigateway` and `lambda` come off; `s3`, `sqs`, `sns`, `secretsmanager`, `iam`, `sts`, `cloudformation` stay (the last three because the team still drives a CDK synth locally to validate stacks before PR — see §3.5).

The frontend's `?? 'http://localhost:3001/local'` fallback in `packages/frontend/src/services/http.ts` was a holdover from when API Gateway sat behind a `$default` stage at `/local`. Because the dev server is plain `node:http` mounted at `/api/v1`, the fallback is removed; the base URL is now `http://localhost:3001/api/v1` everywhere. The `/shared/.api-url` reader in `packages/frontend/vite-env.ts` is removed because the `shared-data` Docker volume it used to consult (deployer wrote the URL, frontend read it back) is gone.

This change also closes `add-localstack-dev-env` as **superseded**, not implemented — see §3.6.

---

## 2. Scope

### 2.1 In scope (ship in this change)

| Area                                                                                                                                                                           | Why                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `scripts/dev-server.ts` — new file (~150 LOC, `node:http` + `tsx`, no new npm deps)                                                                                            | Replaces `docker/deployer/` with the smallest possible native HTTP wrapper around real handlers. |
| Reuse `LAMBDAS` from `packages/infra/src/stacks/ApiStack.ts:60-127`                                                                                                            | One route table, no parallel source of truth.                                                    |
| Build an `APIGatewayProxyEvent` v2 from incoming HTTP request                                                                                                                  | Lets the same `handler` that ships to AWS run unmodified locally.                                |
| Mount under `/api/v1` on port 3001                                                                                                                                             | Matches AWS path so frontend URL is the same in dev and prod.                                    |
| Drop `docker/deployer/`, `docker/s3-proxy/`, `scripts/dev-up.sh`, `scripts/dev-down.sh`                                                                                        | Sidecars that hide the LocalStack gap are gone.                                                  |
| Trim `docker-compose.dev.yml`: remove `deployer` + `s3-proxy` services + `shared-data` volume                                                                                  | One compose, fewer moving parts.                                                                 |
| Trim `.env.dev*`: remove `AWS_ENDPOINT_URL_S3`, `LOCALSTACK_BIND_HOST`, `LAMBDA_*`, `DEPLOYER_*`, `S3_PROXY_*`, `SHARED_DATA_DIR`, `API_URL_FILE`, `API_GATEWAY_HOST_EXTERNAL` | Stale vars that referenced the deleted sidecars go too.                                          |
| Reduce LocalStack `SERVICES` env: keep `s3,sqs,sns,secretsmanager,iam,sts,cloudformation`; remove `apigateway,lambda`                                                          | LocalStack stays, scope shrinks.                                                                 |
| Frontend `http.ts`: remove `?? 'http://localhost:3001/local'` fallback; base URL → `http://localhost:3001/api/v1`                                                              | Frontend talks to the dev server directly at the same path it would use in prod.                 |
| Remove `/shared/.api-url` reader from `packages/frontend/vite-env.ts`                                                                                                          | The shared volume that justified it is gone.                                                     |
| Mark `add-localstack-dev-env/proposal.md` as superseded (single-line append)                                                                                                   | Closes the older change without rewriting history.                                               |
| Rewrite `docs/LOCAL-DEV.md` + update `README.md` "Local development"                                                                                                           | The old quickstart mentions `deployer`, `shared/`, `.api-url` — none of those exist anymore.     |
| Add npm scripts at repo root: `dev:up` (docker), `dev:api` (tsx dev-server), `dev:web` (vite), `dev` (concurrently)                                                            | One `pnpm dev` brings everything up.                                                             |
| Unit test asserting `scripts/dev-server.ts` imports `LAMBDAS` from `@mercadoexpress/infra` (not a parallel literal)                                                            | Guarantees the single-source-of-truth invariant.                                                 |

### 2.2 Out of scope (deliberate exclusions — see §9)

- No CDK stack changes. `ApiStack.ts`, `DbStack.ts`, `FrontendStack.ts` ship to AWS unchanged.
- No Lambda handler code changes. Handlers are reused as-is.
- No SAM CLI, no `serverless` framework, no `aws-lambda-ric`. Pure `node:http`.
- No replacement of the `vitest` test runner or the test harness.
- No Playwright e2e changes beyond updating `VITE_API_BASE_URL` to the new base URL.
- No removal of LocalStack itself (only its `SERVICES` list changes).
- No new top-level dependencies in `package.json`. `tsx` is already a workspace dev dep.

---

## 3. Affected areas

### 3.1 New file: `scripts/dev-server.ts` (~150 LOC)

| Concern             | Implementation                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| HTTP layer          | `node:http.createServer`; parse method, path, headers, body stream                                                           |
| Route matching      | `import { LAMBDAS } from '@mercadoexpress/infra'`; resolve `(method, path)` → `LambdaSpec`                                   |
| Event shape         | Build `APIGatewayProxyEventV2` with `version: '2.0'`, `rawPath`, `requestContext.http.method`, etc.                          |
| Handler invocation  | `await spec.handler(event, ctx)` where `ctx` is a minimal `Context` object                                                   |
| Response write-back | `res.statusCode = statusCode; res.setHeader('Content-Type', headers?.['Content-Type'] ?? 'application/json'); res.end(body)` |
| Errors              | 404 (no route match), 500 (handler threw). Catch and log; never propagate to the socket.                                     |
| Port                | `process.env.PORT ?? 3001`; log resolved port on boot.                                                                       |
| Lifecycle           | `SIGINT`/`SIGTERM` → close server → drain in-flight requests → `process.exit(0)`.                                            |

Notes:

- Zero npm deps. `node:http`, `node:url`, `tsx` (already a workspace dev dep) — that's it.
- The `LAMBDAS` import is the testable surface: a unit test reads the exported constant, asserts it has at least one entry, and asserts `scripts/dev-server.ts` imports it from `@mercadoexpress/infra` (TypeScript AST, no runtime).
- No SSE, no streaming responses, no binary uploads in this slice. APIGW v2 supports them; the spec phase picks the minimal v2 shape that exercises every existing handler.

### 3.2 Frontend (`packages/frontend/src/`)

| File               | Change                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `services/http.ts` | Drop `?? 'http://localhost:3001/local'` fallback. Base URL → `http://localhost:3001/api/v1`. |
| `vite-env.ts`      | Remove the `/shared/.api-url` reader and its accompanying fs import.                         |

Why both: the `/local` fallback was a stage-stub from when API Gateway sat behind a `$default` stage. The `.api-url` reader was a contract for the `shared-data` Docker volume where `deployer` wrote the resolved API URL. Both contracts die with the sidecar.

### 3.3 Docker (`docker-compose.dev.yml` and `docker/`)

| Action                                             | Detail                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Remove `deployer` service                          | Whole block, including its `healthcheck`, `depends_on`, `env_file`.                                                 |
| Remove `s3-proxy` service                          | Whole block (nginx upstream hack).                                                                                  |
| Remove `shared-data` volume                        | It existed only to bridge `deployer` ⇄ `frontend` via `/shared/.api-url`.                                           |
| Trim LocalStack `SERVICES` env                     | `s3,sqs,sns,secretsmanager,iam,sts,cloudformation` (drop `apigateway,lambda`).                                      |
| Keep `postgres`, `localstack`, `frontend` services | `postgres` is needed by handlers; `localstack` remains for AWS-managed services; `frontend` is the Vite dev server. |

Files deleted:

- `docker/deployer/Dockerfile`
- `docker/deployer/entrypoint.sh`
- `docker/s3-proxy/Dockerfile`
- `docker/s3-proxy/nginx.conf` (if present)
- `scripts/dev-up.sh`
- `scripts/dev-down.sh`

### 3.4 Env var cleanup (`.env.dev`, `.env.dev.example`)

Removed (stale refs to deleted sidecars):

- `AWS_ENDPOINT_URL_S3`
- `LOCALSTACK_BIND_HOST`
- `LAMBDA_*` (any)
- `DEPLOYER_*` (any)
- `S3_PROXY_*` (any)
- `SHARED_DATA_DIR`
- `API_URL_FILE`
- `API_GATEWAY_HOST_EXTERNAL`

Kept (still meaningful in the new flow):

- `POSTGRES_*`, `DATABASE_URL`, `JWT_SECRET`, `LOCALSTACK_HOST`, `LOCALSTACK_PORT`, `AWS_*` (region/access-key only), `STAGE=localstack`, `FRONTEND_PORT`, `VITE_API_BASE_URL` (= `http://localhost:3001/api/v1`).

### 3.5 Infrastructure (`packages/infra/src/`)

| File                               | Change                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stacks/ApiStack.ts`               | **No change.** The `LAMBDAS` constant at lines 60-127 stays the source of truth.                                                                                                                      |
| All other stacks                   | **No change.** AWS deploy story is unchanged.                                                                                                                                                         |
| Local CDK synth against LocalStack | Optional. If the team wants to validate a stack synth before PR, they still can — `iam/sts/cloudformation` are kept in `SERVICES` so the deployer-style sanity check is possible without the wrapper. |

### 3.6 Document updates

| File                                                  | Change                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `openspec/changes/add-localstack-dev-env/proposal.md` | Append `## Status: superseded by replace-localstack-dev-server on 2026-07-10`. No body rewrite.                        |
| `docs/LOCAL-DEV.md`                                   | Full rewrite. Sections: Prerequisites · First run (`pnpm dev`) · Troubleshooting · Reset · What runs where.            |
| `README.md`                                           | Update "Local development" section. Replace any mention of `deployer`, `s3-proxy`, `.api-url`, `LOCALSTACK_BIND_HOST`. |

### 3.7 npm scripts (repo root `package.json`)

| Script     | Command                                                                                           | Purpose                                        |
| ---------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `dev`      | `concurrently -k -n db,api,web -c blue,green,magenta "pnpm dev:up" "pnpm dev:api" "pnpm dev:web"` | The one command (`pnpm dev`) brings it all up. |
| `dev:up`   | `docker compose -f docker-compose.dev.yml up -d`                                                  | postgres + localstack (no sidecars).           |
| `dev:api`  | `tsx scripts/dev-server.ts`                                                                       | Native dev server.                             |
| `dev:web`  | `pnpm -C packages/frontend dev`                                                                   | Vite.                                          |
| `dev:down` | `docker compose -f docker-compose.dev.yml down`                                                   | Stop containers (preserve volumes).            |

The concurrent runner choice (`concurrently` vs `npm-run-all2`) is an open implementation detail left to design — see §8.

---

## 4. User stories

### US-1 — One-command local stack (replaces `add-localstack-dev-env` US-1..US-3)

**As a** developer, **I want to** run `pnpm dev` once and have postgres, localstack, the dev server, and the Vite frontend running, **so that** I can hit `http://localhost:5173` and start logging in without further setup.

**Acceptance criteria:**

- [ ] `pnpm dev` brings the four services online (postgres, localstack, dev server, frontend) and stays in the foreground logging each.
- [ ] `pg_isready` reaches `accepting connections` before `dev:api` starts.
- [ ] LocalStack `/_localstack/health` returns `{"s3": "available", "sqs": "available", "sns": "available", "secretsmanager": "available"}` (no `apigateway`, no `lambda`).
- [ ] `curl http://localhost:3001/api/v1/health` returns 200 from the dev server (handler-defined; can be a no-op or a dedicated `/health` route — spec decides).
- [ ] `curl http://localhost:5173` serves the Vue login page.

### US-2 — Real handlers, not emulated API Gateway (replaces LocalStack faith)

**As a** developer, **I want** every request to hit the same handler code that ships to AWS, **so that** "works locally, fails in prod" stops being a class of bug.

**Acceptance criteria:**

- [ ] The dev server imports `LAMBDAS` from `@mercadoexpress/infra` and resolves routes from it (verified by a vitest assertion — the constant is the only route table).
- [ ] A request to `POST http://localhost:3001/api/v1/auth/login` calls the `auth-lambda` `handler` directly with an `APIGatewayProxyEventV2` and writes the handler's response back.
- [ ] Adding a new route in `ApiStack.ts → LAMBDAS` is enough for it to work locally — no edit to `dev-server.ts` needed (the route table drives both).

### US-3 — LocalStack stays for AWS-managed bits

**As a** developer who needs an S3 bucket or an SQS queue for a local experiment, **I want** LocalStack still running, **so that** I don't have to mock AWS-managed services in code.

**Acceptance criteria:**

- [ ] `docker compose ps` shows `localstack` after `pnpm dev:up`.
- [ ] The LocalStack container's `SERVICES` env equals `s3,sqs,sns,secretsmanager,iam,sts,cloudformation` — no `apigateway`, no `lambda`.
- [ ] `aws --endpoint-url http://localhost:4566 s3 ls` returns the buckets the dev stack created.
- [ ] `aws --endpoint-url http://localhost:4566 secretsmanager list-secrets` works (no IAM handshake thrashing).

### US-4 — Frontend talks to the dev server like it talks to AWS

**As a** developer, **I want** the frontend's HTTP base URL to match what it would be in production, **so that** I edit one config and it points at AWS.

**Acceptance criteria:**

- [ ] `VITE_API_BASE_URL=http://localhost:3001/api/v1` in `packages/frontend/.env.development`.
- [ ] `packages/frontend/src/services/http.ts` reads only `VITE_API_BASE_URL`; no `/local` fallback anywhere.
- [ ] `packages/frontend/src/vite-env.ts` no longer reads `/shared/.api-url`.
- [ ] `login` → `POST /api/v1/auth/login` succeeds end-to-end against a handler running in `scripts/dev-server.ts`.

### US-5 — Single source of truth for routes

**As a** reviewer, **I want** a unit test that locks in the shared constant, **so that** nobody reintroduces a parallel route table in the dev server.

**Acceptance criteria:**

- [ ] `scripts/dev-server.test.ts` parses `scripts/dev-server.ts` (or imports it as a module) and asserts that `LAMBDAS` is imported from `@mercadoexpress/infra`.
- [ ] A second assertion checks that the route map contains a known entry from `ApiStack.ts` (e.g. `POST /api/v1/auth/login`).
- [ ] The test fails if anyone changes `dev-server.ts` to define its own route map literal.

---

## 5. What does NOT change

These are deliberately untouched in this change, even where the old infra touched them:

| Area                                                               | Reason                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/infra/src/stacks/*`                                      | AWS deploy story is the source of truth; the dev server is a downstream consumer of `LAMBDAS`. |
| `packages/backend/src/*/interface/`                                | Lambda handlers run as-is.                                                                     |
| `packages/backend/src/*/infrastructure/`                           | Prisma clients, JWT helpers, bcrypt — all reused unchanged.                                    |
| `packages/shared/src/*`                                            | Domain primitives, Zod schemas, error envelope — unchanged.                                    |
| `.github/workflows/*`                                              | CI still runs against AWS; no CI-side change here.                                             |
| Test runner (vitest), e2e runner (playwright), coverage thresholds | These are config-locked; not touched.                                                          |

---

## 6. Why this is smaller and safer than the old approach

| Concern                                | Old (`deployer` + `s3-proxy`)                                                                                | New (`scripts/dev-server.ts`)                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| First-time boot                        | `cdk bootstrap` (≈30s) + `cdk deploy` (≈3-7 min), asset zips, lambda creation                                | `pnpm dev:api` (≈1s); DB connect only                                                   |
| Iteration speed                        | `cdk watch` round-trips on every change                                                                      | `tsx --watch` reloads in <1s                                                            |
| What breaks when dev fails             | IAM role inconsistency, asset upload stalled, container zombie                                               | HTTP 500 with a stack trace; restart `dev:api`                                          |
| Risk of "works locally, fails in prod" | High — APIGW path/stage behavior diverges from AWS                                                           | None — same handler, same event shape                                                   |
| Onboarding surface                     | Three new files (`deployer/Dockerfile`, `deployer/entrypoint.sh`, `s3-proxy/nginx.conf`) + cdk-context flags | One new file (`scripts/dev-server.ts`, ~150 LOC) + three script lines in `package.json` |
| Side effects in compose                | `shared-data` volume, port collisions on `BIND_HOST`, drift between `.env.dev` and container env             | One container per service; no volume writes from compose path                           |

---

## 7. Risks

Severity reflects probability × blast radius for this slice. Mitigations live in spec (S), design (D), tasks (T), or apply (A).

| ID  | Risk                                                                                    | Severity | Why                                                                                                                                                                                                             | Mitigation (location)                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | Dev server drift from real APIGW v2 event shape                                         | **High** | APIGatewayProxyEventV2 has subtle fields (`requestContext.http`, `version`, `cookies`, `rawPath`) — if `dev-server.ts` builds them wrong, handlers will accept dev input that AWS would reject (or vice versa). | Spec pins the event-shape fixture to a unit test that mirrors the AWS docs verbatim; design adds a comparison table vs. real APIGW; in tests, run the same handler over the dev event vs. a frozen AWS event for the same input and assert identical JSON output (S, D, T, A). |
| R-2 | Handler-side crash in dev is uncaught at the socket                                     | Medium   | A `throw` inside `handler` is a developer outage, not a "LocalStack gap" outage.                                                                                                                                | `try/catch` around the `await spec.handler(event, ctx)` call; log the stack; return `500 { code: "DEV_SERVER_ERROR", message: "see server logs" }`; a vitest verifies the wrap (D, T).                                                                                         |
| R-3 | LocalStack container keeps old `apigateway`/`lambda` state from a previous run          | Medium   | Even with `SERVICES` trimmed, a stale container might respond on `:4566` for those endpoints.                                                                                                                   | `docker compose down -v` is the documented reset; `docs/LOCAL-DEV.md` calls this out; the `pnpm dev:down` script does NOT delete volumes by default (C-18-ish legacy), but a separate `pnpm dev:reset` does (D, T).                                                            |
| R-4 | Frontend Vite still tries to read `/shared/.api-url` because of a stale cache           | Medium   | Stale Vite cache or `node_modules/.vite` may hold the old reader.                                                                                                                                               | Vite cache cleared in `pnpm dev:reset`; document the cleanup in `docs/LOCAL-DEV.md` (T, A).                                                                                                                                                                                    |
| R-5 | Concurrent runner choice (`concurrently` vs `npm-run-all2`) churns the npm script shape | Low      | Different color/log behaviour, prefix flags, `--kill-others` semantics differ.                                                                                                                                  | Design picks one and the spec encodes the exact command; lock the dep version in `package.json` (D, T).                                                                                                                                                                        |
| R-6 | New `dev:up` no longer provisions LocalStack-resolved buckets the team relied on        | Low      | If any local-only code path uses a LocalStack-created S3 bucket, the `cdk deploy` path is gone.                                                                                                                 | The scope of this change keeps S3 in `SERVICES`; teams that need real bucket creation run an ad-hoc `aws --endpoint-url http://localhost:4566 s3 mb` until the next iteration adds it back via CDK synth (D, T).                                                               |
| R-7 | Shared volume `shared-data` removal could orphan scripts that referenced it             | Low      | Quick grep needed before deletion.                                                                                                                                                                              | Tasks phase must grep for `shared-data`, `API_URL_FILE`, `/shared/.api-url` and remove all references in the same PR (T).                                                                                                                                                      |

### 7.1 High-severity rationale

**R-1 (event shape drift):** this is the only risk whose failure mode is "looks fine in dev, fails at the AWS edge" — exactly the class of bug the change is meant to eliminate. Mitigation must be machine-checkable, not aspirational. The spec therefore mandates a unit test that runs the chosen handler over the dev-built event, captures the JSON output, then runs it again over a frozen AWS event for the same input, and asserts byte-equality on `response`. Anything less gives back the bug we just paid down.

---

## 8. Open questions for spec / design

The orchestrator has locked all architecture decisions (see Quick path). These remaining questions are implementation details for the next two phases.

| ID   | Question                                                                                                                    | Phase  | Why it matters                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Q-S1 | Exact APIGW v2 event fixture: copy from the AWS HTTP API payload reference verbatim, or trim to fields handlers read?       | spec   | Over-spec leads to drift; under-spec breaks handlers that read fields we stripped.                    |
| Q-S2 | `/health` route: dedicated Lambda entry in `LAMBDAS`, or a hard-coded 200 in `dev-server.ts`?                               | spec   | Health endpoints usually don't need a Lambda; reserving `LAMBDAS` entries for prod routes is cleaner. |
| Q-S3 | Error envelope shape on dev-server failures: reuse the prod `{ code, message }` shape, or add a `DEV_SERVER_ERROR` code?    | spec   | Easier debugging if the envelope is uniform; no risk to prod because it never touches prod.           |
| Q-S4 | Logging: JSON via `pino` (matches prod), or human-readable `console.log` for dev?                                           | spec   | Affects the wrapper's actual code size and DX.                                                        |
| Q-D1 | Which concurrent runner: `concurrently` (more colors, better signal handling) vs `npm-run-all2` (simpler, fewer deps)?      | design | The `dev` script shape depends on this; design picks and writes the exact command.                    |
| Q-D2 | Hot reload: `tsx --watch scripts/dev-server.ts` alone, or a `nodemon` wrapper, or no watch (manual restart)?                | design | Affects loop time and dependencies; design picks.                                                     |
| Q-D3 | LocalStack health gate inside the `dev` script: wait-for-healthy wrapper, or just rely on `depends_on: healthy` in compose? | design | Compose-level depends_on handles it; if design prefers belt-and-braces, the runner waits too.         |
| Q-D4 | `pnpm dev:reset`: separate from `dev:down` (no volume delete) and `dev:nuke` (delete everything); or one combined command?  | design | Affects what we teach new devs.                                                                       |

No product/UX question remains open. P-route decisions are all locked from the orchestrator's earlier rounds.

---

## 9. Non-goals

These outcomes are explicitly NOT delivered in this change:

- **Removing LocalStack.** LocalStack stays; `SERVICES` shrinks only.
- **CDK stack changes.** `ApiStack.ts`, `DbStack.ts`, `FrontendStack.ts` are untouched.
- **Lambda handler edits.** Handlers run as-is, unmodified.
- **Production-grade HTTP server.** No TLS, no HTTP/2, no clustering — `node:http` on a single Node process. Dev server only.
- **SAM CLI / `serverless` framework.** The wrapper is intentionally a small, transparent `tsx` script.
- **Replacement of vitest, playwright, or any test runner.**
- **New top-level npm dependencies.** `concurrently` (or `npm-run-all2`) is a fresh dev dep, but it's the runner for the `dev` script; that is the only addition.
- **Playwright config changes.** `VITE_API_BASE_URL` update is the only e2e tweak.
- **CI/CD changes.** `.github/workflows/*` is untouched.
- **Authentication simulation differences.** JWT validation runs identically in dev and prod (same `JWT_SECRET` env, same `jose` call).
- **Removing the `add-localstack-dev-env` history.** It is marked superseded, not deleted.

---

## 10. Rollback plan

This is a dev-ergonomics change, not a deploy. Rollback = restore the deleted files and revert the trim. Three layers:

### 10.1 File-system rollback

- `git revert` of this change's PR restores `docker/deployer/`, `docker/s3-proxy/`, `scripts/dev-up.sh`, `scripts/dev-down.sh`, and the compose entries.
- The `.env.dev*` keys (`AWS_ENDPOINT_URL_S3`, `LOCALSTACK_BIND_HOST`, `LAMBDA_*`, `DEPLOYER_*`, `S3_PROXY_*`, `SHARED_DATA_DIR`, `API_URL_FILE`, `API_GATEWAY_HOST_EXTERNAL`) come back in the revert.
- `scripts/dev-server.ts` is deleted by the same revert.
- `docker compose down -v && git checkout main && pnpm dev:up` restores the old flow in ≈30 seconds.

### 10.2 Docs rollback

- `docs/LOCAL-DEV.md` and `README.md` "Local development" revert to the pre-change versions in the same revert.
- The `Status: superseded` line on `openspec/changes/add-localstack-dev-env/proposal.md` stays — that addition is informational and harmless if the change is rolled back.

### 10.3 Frontend rollback

- The `?? 'http://localhost:3001/local'` fallback restore is in the same revert; the `/shared/.api-url` reader restore is too.
- If the shared volume was deleted by `pnpm dev:reset`, the dev environment needs `docker volume create shared-data` (one-time) before the reverted dev-up can write into it again. Documented in the revert's PR description.

### 10.4 What cannot be rolled back

- Handlers' runtime behavior — none of them change, so there's nothing to revert there.
- The unit test that locks the shared route table: if reverted, that test goes with the dev server. Re-adding it is a fresh commit.

---

## 11. Success criteria

The change is "done" when every line below is verifiable on a fresh dev machine after `pnpm dev`.

**Single-command boot**

- [ ] `pnpm dev` brings up postgres, localstack, `scripts/dev-server.ts`, and Vite, all in one terminal.
- [ ] No `cdk bootstrap`, no `cdk deploy`, no `shared-data` volume, no `s3-proxy`.
- [ ] First boot finishes in ≤ 30 seconds (DB + LocalStack warm + dev server up); subsequent boots ≤ 15 seconds.

**Functional parity with the AWS APIGW v2 surface**

- [ ] `POST http://localhost:3001/api/v1/auth/login` invokes the `auth-lambda` `handler` and returns the same response shape AWS APIGW v2 would.
- [ ] Every route registered in `LAMBDAS` (packages/infra/src/stacks/ApiStack.ts:60-127) is reachable at `http://localhost:3001/api/v1/...`.
- [ ] Adding a new entry to `LAMBDAS` (and a corresponding handler) is enough to make it work locally — no edit to `scripts/dev-server.ts`.

**LocalStack scope**

- [ ] `docker compose ps` shows `localstack` running.
- [ ] The container's `SERVICES` env is exactly `s3,sqs,sns,secretsmanager,iam,sts,cloudformation`.
- [ ] `apigateway` and `lambda` are absent from `SERVICES`; no request from the dev server or the frontend ever hits them.
- [ ] `aws --endpoint-url http://localhost:4566 s3 ls` and `… secretsmanager list-secrets` still succeed.

**Cleanup**

- [ ] `docker/deployer/`, `docker/s3-proxy/`, `scripts/dev-up.sh`, `scripts/dev-down.sh` are deleted from the tree.
- [ ] `deployer` and `s3-proxy` services, plus the `shared-data` volume, are absent from `docker-compose.dev.yml`.
- [ ] `.env.dev*` does not contain `AWS_ENDPOINT_URL_S3`, `LOCALSTACK_BIND_HOST`, `LAMBDA_*`, `DEPLOYER_*`, `S3_PROXY_*`, `SHARED_DATA_DIR`, `API_URL_FILE`, `API_GATEWAY_HOST_EXTERNAL`.

**Frontend**

- [ ] `VITE_API_BASE_URL=http://localhost:3001/api/v1` in `packages/frontend/.env.development`.
- [ ] `packages/frontend/src/services/http.ts` has no `/local` fallback.
- [ ] `packages/frontend/src/vite-env.ts` has no `/shared/.api-url` reader.
- [ ] Login → token → authenticated request → 401 on missing token works end-to-end from the SPA through the dev server.

**Documentation**

- [ ] `docs/LOCAL-DEV.md` rewritten; does not mention `deployer`, `s3-proxy`, `.api-url`, or `API_GATEWAY_HOST_EXTERNAL`.
- [ ] `README.md` "Local development" section updated; same words removed.
- [ ] `openspec/changes/add-localstack-dev-env/proposal.md` carries the line `## Status: superseded by replace-localstack-dev-server on 2026-07-10`.

**Quality gates**

- [ ] A vitest unit test asserts `scripts/dev-server.ts` imports `LAMBDAS` from `@mercadoexpress/infra` (no parallel literal).
- [ ] A second vitest asserts a known route (e.g. `POST /api/v1/auth/login`) is reachable through `dev-server.ts` by exercising the real handler via a fake socket.
- [ ] `pnpm -w vitest run`, `pnpm -w eslint`, and `pnpm -w tsc --noEmit` all pass.
- [ ] Strict TDD followed: the dev server's test fails on `main` before this PR (because `LAMBDAS` isn't imported yet), then passes after.
- [ ] PR size ≤ 400 changed lines; otherwise the chained-PR pattern from `config.yaml → delivery` applies.

---

## 12. Out of the room (people + timelines)

- No PM work. No design system work. No security review needed (no auth/payment path touched — handlers and JWT validation are unmodified).
- One PR if it lands under 400 LOC; otherwise split as: (a) `scripts/dev-server.ts` + unit test + `package.json` scripts, (b) `docker-compose.dev.yml` + env trim + frontend fixes, (c) docs + supersede marker. Each PR is independently mergeable.

---

## Next step

Hand this proposal to the `sdd-spec` phase. The spec phase will:

1. Lock the APIGW v2 event fixture (Q-S1).
2. Decide `/health` shape and the error envelope for dev-server failures (Q-S2, Q-S3).
3. Decide the dev-server logging style (Q-S4).
4. Produce one spec file under `openspec/changes/replace-localstack-dev-server/specs/`.

The design phase picks the concurrent runner, hot-reload story, and health-gate (Q-D1..Q-D4). Tasks cover every acceptance criterion in §11. Apply implements the tasks; verify confirms both the unit-test lock on `LAMBDAS` and the end-to-end login flow against the dev server.

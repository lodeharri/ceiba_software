# Tasks: `replace-localstack-dev-server` — native Node wrapper, drop CDK-in-LocalStack

**Phase:** sdd-tasks · **Change folder:** `openspec/changes/replace-localstack-dev-server/`
**Inputs consumed:** `proposal.md`, 7 spec files under `specs/`, `design.md` (§1–§12), `openspec/config.yaml`, `openspec/AGENTS.md`, `openspec/changes/add-inventory-mvp/tasks.md` (format reference).
**Strict TDD:** ACTIVE — RED → GREEN → TRIANGULATE → REFACTOR per `config.yaml → testing.tdd_workflow`. Production code ships with a failing test first; obsolete tests are deleted, never skipped.

---

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~950 file-system / ~660 net (per `design.md` §7.1)                                                                                                                                                         |
| 400-line budget risk    | High                                                                                                                                                                                                       |
| Chained PRs recommended | Yes                                                                                                                                                                                                        |
| Suggested split         | PR 1 (native-dev-server, ~350 LOC) → PR 2 (compose/env trim + docker/frontend delete, ~330 LOC) → PR 3 (frontend rewires + docs + grep guard, ~430 LOC file-system; each commit-pair stays well under 400) |
| Delivery strategy       | ask-on-risk                                                                                                                                                                                                |
| Chain strategy          | stacked-to-main (default per `config.yaml → delivery.chain_strategy`)                                                                                                                                      |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

**Rationale**

- The single-PR Option 1 from `design.md` §7.2 sums to ~660 net / ~950 file-system changed lines (GitHub diff measures changed lines, not net lines). That is 2.4× the 400-line review cap, so the Review Workload Guard **mandates** chained PRs regardless of speed-first preference.
- The three-PR split (Option 2 in `design.md` §7.2) keeps each PR under ~435 file-system changed lines and each PR is independently mergeable: PR 1 ships an opt-in `dev:api` script without touching compose or env, so the existing dev flow keeps working alongside; PR 2 trims compose + env and deletes the sidecars; PR 3 rewires the frontend and rewrites the docs.
- `delivery.strategy = ask-on-risk` is the cached setting per `config.yaml → delivery.strategy`; the orchestrator surfaces the chained-PR confirmation to the user before apply.
- Chain strategy `stacked-to-main` matches `config.yaml → delivery.chain_strategy`: each PR merges to `main` in order, no integration branch.

---

## Work-unit groups (chained PRs)

Three PR-shaped work units, ordered by dependency. Each has clear start, finish, verification, and rollback boundaries. Boundaries marked with `<!-- PR BOUNDARY -->`.

### PR 1 — Native dev-server

**Goal:** Introduce `scripts/dev-server.ts` (native `node:http` wrapper around the real Lambda handlers, importing `LAMBDAS` from `@mercadoexpress/infra`) plus the root npm scripts (`dev`, `dev:api`, `dev:web`, `dev:up`, `dev:down`, `dev:reset`) that orchestrate the new flow. Compose, env files, and frontend are untouched in this PR — the existing dev workflow keeps working alongside the new opt-in script.

**Depends on:** nothing.
**Mergeable after:** `pnpm -w vitest run` is green AND `tsx scripts/dev-server.ts` boots successfully against the existing compose (or in isolation with stubbed handlers).

**Capabilities in this PR:** Capability 1 (native-dev-server, REQ-NDS-1..9).

---

#### Capability 1: native-dev-server (REQ-NDS-1..9)

##### Task 1.1: Scaffold dev-server skeleton with LAMBDAS import + graceful shutdown (REQ-NDS-1, NDS-9)

- [x] **RED:** `scripts/dev-server.test.ts` — assert that `scripts/dev-server.ts` parses as a TS module, exports a `boot()` and a `createDevServer({ lambdas })` factory, and that the production module imports `LAMBDAS` from `'@mercadoexpress/infra'` (REQ-NDS-2 scenario 1 lock via TypeScript AST parse, no runtime).
- [x] **GREEN:** create `scripts/dev-server.ts` that imports `LAMBDAS` from `@mercadoexpress/infra`, exports a `createDevServer({ lambdas, port = process.env.PORT ?? 3001 })` factory, and a `boot()` that calls `createDevServer({ lambdas: LAMBDAS }).listen()`. Bind to `127.0.0.1` (NFR-5). Emit `listening on http://localhost:<port>` on bind.
- [x] **TRIANGULATE:** vitest asserting the listening port is `3001` when `PORT` is unset, and `4002` when `process.env.PORT = "4002"`; assert `GET /` returns `404 ROUTE_NOT_REGISTERED` envelope (REQ-NDS-1 scenario 3).
- [x] **REFACTOR:** extract `resolvePort()` and `bindAddress()` helpers.
- [ ] **Acceptance:** `tsx scripts/dev-server.ts` prints `listening on http://localhost:3001`; `curl http://localhost:3001/` returns `404 { code: "ROUTE_NOT_REGISTERED", message: "GET / is not mounted" }`; vitest green.
- [x] **Files:** `scripts/dev-server.ts` (C), `scripts/dev-server.test.ts` (C).

##### Task 1.2: APIGatewayProxyEventV2 builder (REQ-NDS-3 + R-1 mitigation)

- [x] **RED:** `scripts/dev-server.event-shape.test.ts` — build an event for `POST /auth/login` with `Content-Type: application/json` + `{"username":"a","password":"b"}`, assert the JSON serialization has every field listed in `REQ-NDS-3` (`version: '2.0'`, `routeKey`, `rawPath`, `rawQueryString`, `headers`, `requestContext.http.{method,path,protocol,sourceIp,userAgent}`, `requestContext.{requestId,routeKey,stage,time,timeEpoch}`, `body`, `isBase64Encoded:false`, `cookies:[]`).
- [x] **GREEN:** extract `scripts/events/apigw-v2-builder.ts` exporting `toApiGatewayProxyEventV2(req, method, rawPath, rawQuery, headers, body, cookies)` with the locked field set per `design.md` §3.2.
- [x] **TRIANGULATE:** assert `body` is `undefined` (NOT `''`) when `Content-Length` is `0` (EC-4); assert multi-value headers join with `,`; assert cookies split from the `Cookie` header preserving order (EC-3); assert `body` is `undefined` on GET.
- [x] **REFACTOR:** split into `headersToRecord(headers)` + `parseCookies(header)` pure helpers.
- [ ] **Acceptance:** `pnpm -w vitest run scripts/dev-server.event-shape.test.ts` green; the builder produces a `JSON.stringify`-stable shape.
- [x] **Files:** `scripts/events/apigw-v2-builder.ts` (C), `scripts/dev-server.event-shape.test.ts` (C).

##### Task 1.3: AWS-byte-equality assertion (REQ-NDS-3 + R-1 byte-equality)

- [x] **RED:** extend `scripts/dev-server.event-shape.test.ts` — load `test/fixtures/aws-apigw-v2-event.sample.json`, pass it to a stub handler that records the received event, pass the dev-built event for the same `(method, path, body, headers)` to the same stub handler, assert `JSON.stringify(stub.awsResult) === JSON.stringify(stub.devResult)` for every field the handler reads.
- [x] **GREEN:** capture a sample AWS APIGW v2 event JSON into `test/fixtures/aws-apigw-v2-event.sample.json` (frozen, hand-written based on the AWS HTTP API payload reference).
- [x] **TRIANGULATE:** assert equality holds across three different methods (`GET`, `POST`, `OPTIONS`); assert equality breaks (test fails) if the builder drops a field — use a "shadow" builder that omits `cookies` to prove the comparison is real.
- [x] **REFACTOR:** none.
- [ ] **Acceptance:** the byte-equality assertion passes against the current builder; the test would fail if any field is dropped, reordered, or misformatted.
- [x] **Files:** `test/fixtures/aws-apigw-v2-event.sample.json` (C — frozen fixture), `scripts/dev-server.event-shape.test.ts` (M).

##### Task 1.4: Route matching + invokeHandler + writeResponse (REQ-NDS-2, NDS-4, NDS-6)

- [x] **RED:** extend `scripts/dev-server.test.ts` — pass a stub `lambdas` array with one entry `{ routeKey: "POST /auth/login", handler, functionName: "auth-lambda" }`; assert `POST /api/v1/auth/login` (via supertest-style fake socket) returns the handler's response body verbatim, with `Content-Type` defaulted to `application/json` when missing; assert `GET /api/v1/products` for a stub entry returns 200 with body and headers preserved (REQ-NDS-4 scenarios 1 + 2).
- [x] **GREEN:** implement `matchRoute(method, pathAfterPrefix)`, `invokeHandler(spec, event)` (with `try/catch` per Task 1.5), and `writeResponse(res, result)` in `scripts/dev-server.ts` per `design.md` §3.3–§3.5.
- [x] **TRIANGULATE:** assert `GET /api/v1/nonexistent` returns `404 ROUTE_NOT_REGISTERED` with the exact envelope (REQ-NDS-6); assert `Set-Cookie` headers are emitted as separate response headers (REQ-NDS-4 scenario 3); assert `Content-Type` defaults to `application/json` when handler omits it.
- [x] **REFACTOR:** extract `toErrorEnvelope(code, message, details?)` helper.
- [ ] **Acceptance:** `pnpm -w vitest run scripts/dev-server.test.ts` green; the dev server dispatches to the matching `LambdaSpec.handler` and writes the response back unchanged.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.5: Handler-throw 500 envelope + stderr stack (REQ-NDS-5)

- [x] **RED:** extend `scripts/dev-server.test.ts` — pass a stub handler that `throw new Error("DB unreachable")`; assert the response is `500 DEV_SERVER_ERROR` envelope with `details.requestId` matching a UUID v4; assert the same `requestId` appears in the captured stderr line; assert `socket.end` is NOT called before the body is written.
- [x] **GREEN:** wrap `await spec.handler(event, ctx)` in `try/catch` per `design.md` §3.4; log stack to stderr with `requestId` + routeKey + message; return `{ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'DEV_SERVER_ERROR', message: 'see server logs', details: { requestId } }), isBase64Encoded: false }`.
- [x] **TRIANGULATE:** assert the dev-server envelope's `code` is `DEV_SERVER_ERROR` even when the handler returns `{ statusCode: 500, code: "INTERNAL_ERROR" }` itself (REQ-NDS-5 scenario 2 — the wrapper does NOT rewrite handler-returned envelopes).
- [x] **REFACTOR:** extract `buildDevServerError(requestId, error)` helper.
- [ ] **Acceptance:** `pnpm -w vitest run scripts/dev-server.test.ts` green; thrown handler → 500 envelope + stderr stack with matching `requestId`.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.6: OPTIONS preflight short-circuit (REQ-NDS-7)

- [x] **RED:** extend `scripts/dev-server.test.ts` — assert `OPTIONS /api/v1/auth/login` returns `204` with the five CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key, X-Request-Id`, `Access-Control-Max-Age: 86400`, `Content-Length: 0`) and an empty body; assert NO handler is invoked (the stub handler is never called).
- [x] **GREEN:** implement the OPTIONS short-circuit per `design.md` §3.6 (precedes route matching).
- [x] **TRIANGULATE:** assert `OPTIONS /api/v1/anything-not-in-lambdas` still returns `204` (REQ-NDS-7 scenario 2 — CORS precedes route matching); assert the OPTIONS path is independent of the `lambdas` arg (empty array → still 204).
- [x] **REFACTOR:** extract `corsPreflightHeaders()` helper.
- [ ] **Acceptance:** `curl -X OPTIONS http://localhost:3001/api/v1/auth/login -H 'Origin: http://localhost:5173'` returns `204` with the five headers; the dev-server log does NOT show a handler-invocation line for OPTIONS.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.7: /api/v1/health short-circuit (REQ-NDS-8)

- [x] **RED:** extend `scripts/dev-server.test.ts` — assert `GET /api/v1/health` returns `200 { status: "ok" }` with `Content-Type: application/json`; assert NO handler is invoked.
- [x] **GREEN:** implement the `/health` short-circuit per `design.md` §3.7 (does NOT consult `LAMBDAS`, does NOT add a `/health` entry).
- [x] **TRIANGULATE:** assert `GET /api/v1/health/` (with trailing slash) returns `404 ROUTE_NOT_REGISTERED` (path matching is exact); assert `/health` is NOT in any `lambdas` argument passed to `createDevServer`.
- [x] **REFACTOR:** none.
- [ ] **Acceptance:** `curl http://localhost:3001/api/v1/health` returns `200 {"status":"ok"}`; the dev-server log does NOT show a handler-invocation line.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.8: Body-size threshold + clamp + unknown-method 405 (REQ-NDS-9 EC-1, EC-5, R-8)

- [x] **RED:** extend `scripts/dev-server.test.ts` — (a) send a request with `Content-Length: 2_000_000` and empty body; assert `413 PAYLOAD_TOO_LARGE` envelope without reading the body. (b) Assert `process.env.DEV_SERVER_MAX_BODY_BYTES = '2000000'` allows the same request through. (c) Assert `DEV_SERVER_MAX_BODY_BYTES = '0'` clamps to the floor (`1_048_576`) and emits a single WARN log line at boot. (d) Assert `PATCH /api/v1/auth/login` returns `405 METHOD_NOT_ALLOWED` with `Allow` header listing methods known to `LAMBDAS` for that path (EC-5).
- [x] **GREEN:** (a) Implement the body-size gate per `design.md` §3.9 EC-1: check `Number(req.headers['content-length']) > MAX_BODY` BEFORE reading the body stream; resolve `MAX_BODY` from `Number(process.env.DEV_SERVER_MAX_BODY_BYTES) || 1_048_576` with a `< 1_048_576` floor clamp per R-8. (b) Add the method allowlist (`GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD`) check before `matchRoute`.
- [x] **TRIANGULATE:** assert missing `Content-Length` header falls through (body is not pre-checked); assert `Content-Length: 0` is accepted (no body to read); assert `Allow` header for EC-5 enumerates only the methods actually registered in `LAMBDAS` for that path (not the full allowlist).
- [x] **REFACTOR:** extract `resolveMaxBody(env)` and `allowedMethodsFor(path)` helpers.
- [ ] **Acceptance:** `pnpm -w vitest run scripts/dev-server.test.ts` green; 413 envelope returns before body is read; WARN log fires once when threshold is set below the floor; 405 envelope includes correct `Allow` header.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.9: Cookies writeback (REQ-NDS-4 cookies scenario)

- [x] **RED:** extend `scripts/dev-server.test.ts` — assert a handler returning `{ cookies: ['a=1; HttpOnly', 'b=2'] }` results in TWO `Set-Cookie` response headers in order, with `Content-Length` matching the body length; assert a single-cookie response carries exactly one `Set-Cookie` header.
- [x] **GREEN:** extend `writeResponse` per `design.md` §3.5 to emit one `Set-Cookie` per cookie in `result.cookies` (NOT joined into a single header per RFC 6265).
- [x] **TRIANGULATE:** assert cookies in `result.cookies` are preserved verbatim (no reformat); assert `Content-Length` equals `Buffer.byteLength(result.body ?? '')`.
- [x] **REFACTOR:** extract `setCookies(res, cookies)` helper.
- [ ] **Acceptance:** `pnpm -w vitest run scripts/dev-server.test.ts` green; multi-cookie writeback verified.
- [x] **Files:** `scripts/dev-server.ts` (M).

##### Task 1.10: Root npm scripts + concurrently dep (design §5)

- [x] **RED:** `tests/architecture/scripts-declared.test.ts` — vitest reads root `package.json`, asserts the `scripts` block declares `dev`, `dev:up`, `dev:api`, `dev:web`, `dev:down`, `dev:reset`, and asserts `devDependencies` pins `concurrently` at `^9.0.0` and `tsx` at `^4.19.0`.
- [x] **GREEN:** edit root `package.json` — add the six scripts per `design.md` §5 exact strings (`dev`, `dev:up`, `dev:api`, `dev:web`, `dev:down`, `dev:reset`) and add `concurrently@^9.0.0` + `tsx@^4.19.0` to `devDependencies`. If `packages/infra/src/index.ts` does NOT already re-export `LAMBDAS`, add the re-export so `@mercadoexpress/infra` consumers (i.e. the dev server) can import it.
- [x] **TRIANGULATE:** assert `pnpm dev:reset` script command string equals exactly `docker compose -f docker-compose.dev.yml down -v && rm -rf packages/frontend/node_modules/.vite`; assert `pnpm dev` script string starts with `concurrently -k -n db,api,web -c blue,green,magenta`.
- [x] **REFACTOR:** none.
- [ ] **Acceptance:** `pnpm dev` brings up the four services via `concurrently`; `pnpm dev:api` boots the dev server alone; `pnpm dev:reset` clears containers + Vite cache; `pnpm dev:reset` is idempotent (no-op when `node_modules/.vite` is absent).
- [x] **Files:** `package.json` (M — add scripts + deps), `packages/infra/src/index.ts` (M only if LAMBDAS re-export missing).

##### Task 1.11: Graceful shutdown SIGINT/SIGTERM (REQ-NDS-9)

- [x] **RED:** extend `scripts/dev-server.test.ts` — start the server, send `SIGINT`, assert `process.exit` is called with code `0` after in-flight requests complete; assert `server.close()` is called.
- [x] **GREEN:** wire `process.on('SIGINT', drainAndExit)` and `process.on('SIGTERM', drainAndExit)` per `design.md` §3.10; `setTimeout(() => process.exit(1), 5_000).unref()` as the hard cap.
- [x] **TRIANGULATE:** assert two SIGINTs in a row still exit cleanly (idempotent); assert in-flight request completes with its response before exit (response observable).
- [x] **REFACTOR:** extract `drainAndExit(signal, server)` helper.
- [ ] **Acceptance:** Ctrl+C on the dev server drains in-flight and exits `0` within 5 s.
- [x] **Files:** `scripts/dev-server.ts` (M).

#### Work-unit commits (PR 1)

- `feat(dev-server): scaffold scripts/dev-server.ts with LAMBDAS import + boot (REQ-NDS-1, NDS-2)`
- `feat(dev-server): add APIGatewayProxyEventV2 builder + AWS byte-equality test (REQ-NDS-3, R-1)`
- `feat(dev-server): add route matching + invokeHandler + writeResponse (REQ-NDS-2, NDS-4, NDS-6)`
- `feat(dev-server): add 500 DEV_SERVER_ERROR envelope for handler throws (REQ-NDS-5)`
- `feat(dev-server): add OPTIONS preflight + /health short-circuits (REQ-NDS-7, NDS-8)`
- `feat(dev-server): add body-size threshold + unknown-method 405 (REQ-NDS-9 EC-1, EC-5, R-8)`
- `feat(dev-server): add cookies writeback (REQ-NDS-4)`
- `feat(dev-server): add graceful shutdown on SIGINT/SIGTERM (REQ-NDS-9)`
- `chore(root): add dev/dev:api/dev:web/dev:up/dev:down/dev:reset scripts and concurrently + tsx deps (design §5)`

#### Verification gate (PR 1)

- `pnpm -w vitest run scripts/dev-server.test.ts scripts/dev-server.event-shape.test.ts` → green.
- `pnpm -w tsc --noEmit` → green.
- `pnpm -w eslint .` → green.
- `tsx scripts/dev-server.ts` boots; `listening on http://localhost:3001` printed; `curl http://localhost:3001/api/v1/health` returns 200.
- `git log --grep='^Co-authored-by'` → empty (no AI attribution in commits per `openspec/AGENTS.md`).

#### Rollback plan (PR 1)

- `git revert` the merge commit. The dev server script is opt-in (no other change in the repo invokes it), so reverting restores the prior `docker/deployer`-driven dev flow. No data, no infra touched.

<!-- PR BOUNDARY -->

### PR 2 — Docker compose minimal + env cleanup + frontend container removal

**Goal:** Trim `docker-compose.dev.yml` to `postgres` + `localstack`; drop the `deployer` and `s3-proxy` services and the `shared-data` volume; trim `.env.dev*` to the kept set; delete the `docker/frontend/` directory. PR 1's `dev:api` and `dev:web` scripts keep working; the dev environment now uses one compose file with fewer moving parts.

**Depends on:** PR 1 (the root `package.json` scripts must exist before this PR; otherwise `pnpm dev:up` would fail).

**Mergeable after:** `docker compose -f docker-compose.dev.yml config --services` lists exactly `postgres` and `localstack` AND `pnpm -w vitest run tests/architecture/` green AND `docker compose -f docker-compose.dev.yml up -d postgres localstack` succeeds.

**Capabilities in this PR:** Capability 2 (docker-env-minimal, REQ-DEM-1..6), Capability 3 (env-vars-cleanup, REQ-EVC-1..4), Capability 4 (frontend-native-runtime deletion, REQ-FNR-2 partial).

---

#### Capability 2: docker-env-minimal (REQ-DEM-1..6)

##### Task 2.1: Trim docker-compose.dev.yml to two services (REQ-DEM-1, DEM-2, DEM-4)

- [x] **RED:** `tests/architecture/compose-services.test.ts` — vitest shells out to `docker compose -f docker-compose.dev.yml config --services`, parses the output, and asserts it equals exactly `['localstack', 'postgres']` (sorted, no other service names).
- [x] **GREEN:** edit `docker-compose.dev.yml` — drop `deployer` and `s3-proxy` service blocks entirely; drop the `shared-data` named volume entry; trim `localstack.environment.SERVICES` to exactly `serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation`; remove any `depends_on:` references to the deleted services.
- [x] **TRIANGULATE:** assert `docker compose config | grep -A1 SERVICES` shows the trimmed value (regex `^serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation$`); assert `docker compose config --volumes` does NOT list `shared-data` (REQ-DEM-4 scenario 1).
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `docker compose -f docker-compose.dev.yml config --services` returns `postgres` + `localstack`; `docker volume ls | grep shared` returns nothing.
- [x] **Files:** `docker-compose.dev.yml` (M).

##### Task 2.2: Delete deployer, s3-proxy, and legacy shell scripts (REQ-DEM-3, DEM-6)

- [x] **RED:** `tests/architecture/no-sidecar-refs.test.ts` — vitest asserts `docker/deployer/Dockerfile`, `docker/deployer/entrypoint.sh`, `docker/s3-proxy/Dockerfile`, `docker/s3-proxy/nginx.conf` (if any), `scripts/dev-up.sh`, `scripts/dev-down.sh` do NOT exist (REQ-DEM-3 + REQ-DEM-6 scenarios 1 + 2).
- [x] **GREEN:** delete the six files listed above. (Also covered by R-7 grep guard; same file serves both purposes.)
- [x] **TRIANGULATE:** assert `ls docker/` shows neither `deployer` nor `s3-proxy` subdirectories; assert `ls scripts/` shows neither `dev-up.sh` nor `dev-down.sh`.
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `test -f docker/deployer/Dockerfile` returns non-zero; `test -f scripts/dev-up.sh` returns non-zero.
- [x] **Files:** 6 deletions: `docker/deployer/Dockerfile`, `docker/deployer/entrypoint.sh`, `docker/s3-proxy/Dockerfile`, `docker/s3-proxy/nginx.conf` (if present), `scripts/dev-up.sh`, `scripts/dev-down.sh`.

##### Task 2.3: Verify postgres service + pgvector extension unchanged (REQ-DEM-5)

- [x] **RED:** `tests/architecture/postgres-unchanged.test.ts` — vitest that parses `docker-compose.dev.yml` and asserts the `postgres:` block contains `image: postgres:16`, a `healthcheck` using `pg_isready`, and the `initdb.d` mount that installs the pgvector extension.
- [x] **GREEN:** no production change required — the test passes against the trimmed compose (the postgres block was untouched in Task 2.1).
- [x] **TRIANGULATE:** assert the postgres service block in compose has NOT been removed by the trim; assert no `deployer` or `s3-proxy` keys appear anywhere in the compose file.
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `docker compose exec postgres pg_isready -U postgres` returns 0 with `accepting connections`; `docker compose exec postgres psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname='vector'"` returns `vector`. (`docker/postgres-init/01-pgvector.sql` is intact; pgvector install mechanism unchanged per REQ-DEM-5 EC-4.)
- [x] **Files:** `tests/architecture/postgres-unchanged.test.ts` (C), `packages/infra/test/docker/compose-yaml.test.ts` (M — rewrite to assert the trimmed compose, removes 4 stale assertions + `deployer`/`s3-proxy` mentions).

#### Capability 3: env-vars-cleanup (REQ-EVC-1..4)

##### Task 3.1: Remove stale env vars from .env.dev* (REQ-EVC-1, EVC-2, EVC-4)

- [x] **RED:** `tests/architecture/no-stale-env-vars.test.ts` — vitest greps `.env.dev.example` for the removed set (`AWS_ENDPOINT_URL_S3`, `LOCALSTACK_BIND_HOST`, `LAMBDA_[A-Z_]+`, `DEPLOYER_[A-Z_]+`, `S3_PROXY_[A-Z_]+`, `SHARED_DATA_DIR`, `API_URL_FILE`, `API_GATEWAY_HOST_EXTERNAL`) and asserts zero matches; also asserts no commented-out stragglers mention them.
- [x] **GREEN:** edit `.env.dev.example` — remove the 9 stale keys; ensure kept vars are present (REQ-EVC-2 + REQ-EVC-4). (`.env.dev` is gitignored and personal; the orchestrator's hard rule excludes it from edits; the developer cleans their local `.env.dev` organically when `pnpm dev:up` next fails on a removed key.)
- [x] **TRIANGULATE:** assert required kept vars are still present (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `LOCALSTACK_HOST`, `LOCALSTACK_PORT`, `LOCAL_DEV_NETWORK_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `STAGE`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `FRONTEND_PORT`, `VITE_API_BASE_URL`).
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `grep -E '^(AWS_ENDPOINT_URL_S3|LOCALSTACK_BIND_HOST|LAMBDA_[A-Z_]+|DEPLOYER_[A-Z_]+|S3_PROXY_[A-Z_]+|SHARED_DATA_DIR|API_URL_FILE|API_GATEWAY_HOST_EXTERNAL)=' .env.dev.example` exits 1 (no match); kept vars still present.
- [x] **Files:** `.env.dev.example` (M), `tests/architecture/no-stale-env-vars.test.ts` (C).

##### Task 3.2: No code references to removed env vars (REQ-EVC-3)

- [x] **RED:** `tests/architecture/no-sidecar-refs.test.ts` (extended from Task 2.2) — vitest greps the workspace for the removed set (with PR 1 + PR 3 territory + agent-artifact excludes) and asserts zero matches.
- [x] **GREEN:** no production change required for the grep pass; ancillary updates to `packages/infra/src/constructs/migrations-lambda.ts` (removed `deployer` mentions from comments) + `packages/infra/test/docker/compose-yaml.test.ts` (rewrote to assert the trimmed compose) so the grep guard surfaces real regressions only.
- [x] **TRIANGULATE:** assert no matches for `/shared/\.api-url` or `API_URL_FILE` in `packages/` or `scripts/` (REQ-EVC-3 scenario 2).
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `grep -rE 'shared-data|API_URL_FILE|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3|s3-proxy|deployer' --include='*.ts' --include='*.md' --include='*.yml' --include='*.json' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=coverage --exclude-dir=dist --exclude-dir=.pi-lens --exclude-dir=openspec --exclude-dir=tests --exclude-dir=frontend --exclude-dir=docs --exclude-dir=shared --exclude=README.md --exclude=dev-server.ts .` returns 0 matches.
- [x] **Files:** `tests/architecture/no-sidecar-refs.test.ts` (M — extend Task 2.2's file), `packages/infra/src/constructs/migrations-lambda.ts` (M — comment cleanup), `packages/infra/test/docker/compose-yaml.test.ts` (M — rewrite for trimmed compose).

#### Capability 4: frontend-native-runtime — docker/frontend/ deletion (REQ-FNR-2 + REQ-FVE-5)

##### Task 4.1: Delete docker/frontend/ directory + compose service entry (REQ-FNR-2, FVE-5)

- [x] **RED:** extend `tests/architecture/no-sidecar-refs.test.ts` to assert `docker/frontend/Dockerfile` and `docker/frontend/entrypoint.sh` do NOT exist; assert `docker-compose.dev.yml` has NO `^  frontend:` service entry (REQ-FNR-2 scenario 1); assert the directory `docker/frontend/` is gone.
- [x] **GREEN:** delete `docker/frontend/Dockerfile` and `docker/frontend/entrypoint.sh`; remove the `frontend:` service block from `docker-compose.dev.yml` (removed during Task 2.1's compose trim); remove the empty `docker/frontend/` directory.
- [x] **TRIANGULATE:** assert no env file references `docker/frontend` (`grep -rE 'docker/frontend' docker-compose.dev.yml .env.dev.example` returns 0); assert `docker compose config --services` lists exactly `postgres` + `localstack` (already covered by compose-services.test.ts).
- [x] **REFACTOR:** none.
- [x] **Acceptance:** `test -d docker/frontend` returns non-zero; `docker-compose.dev.yml` lists exactly `postgres` + `localstack`.
- [x] **Files:** `docker/frontend/Dockerfile` (D), `docker/frontend/entrypoint.sh` (D), `docker-compose.dev.yml` (M).

#### Work-unit commits (PR 2)

- `chore(compose): trim docker-compose.dev.yml to postgres + localstack (REQ-DEM-1, DEM-2, DEM-4)`
- `chore(compose): delete deployer + s3-proxy + legacy shell scripts (REQ-DEM-3, DEM-6)`
- `test(architecture): assert postgres service + pgvector unchanged (REQ-DEM-5)`
- `chore(env): trim .env.dev* to kept set (REQ-EVC-1..4)`
- `chore(frontend-runtime): delete docker/frontend/ directory (REQ-FNR-2, FVE-5)`

#### Verification gate (PR 2)

- `docker compose -f docker-compose.dev.yml config --services` → `postgres` + `localstack` only.
- `docker compose -f docker-compose.dev.yml config --volumes` → no `shared-data` entry.
- `docker compose -f docker-compose.dev.yml up -d postgres localstack` → both containers healthy within 30 s.
- `curl -s http://localhost:4566/_localstack/health` → `s3`, `sqs`, `sns`, `secretsmanager` available; no `apigateway`/`lambda` keys (REQ-DEM-2 scenario 2).
- `grep -E '^(AWS_ENDPOINT_URL_S3|LOCALSTACK_BIND_HOST|LAMBDA_[A-Z_]+|DEPLOYER_[A-Z_]+|S3_PROXY_[A-Z_]+|SHARED_DATA_DIR|API_URL_FILE|API_GATEWAY_HOST_EXTERNAL)=' .env.dev .env.dev.example` → no match.
- `pnpm -w vitest run tests/architecture/` → green.
- `pnpm -w tsc --noEmit` → green.

#### Rollback plan (PR 2)

- `git revert` the merge commit restores the trimmed compose, the deleted sidecar directories, the deleted scripts, the deleted frontend container, and the stale env keys. Local dev environment needs `docker compose up -d` after revert; no data was written because the dev DB is rebuilt by compose.

<!-- PR BOUNDARY -->

### PR 3 — Frontend rewires + docs + supersede marker + CI grep guard

**Goal:** Wire the frontend to the dev server (drop `/local` fallback in `http.ts`, remove `/shared/.api-url` reader in `vite-env.ts`, add the `env-validation` Vite plugin that fails loud when `VITE_API_BASE_URL` is missing). Delete the obsolete `vite-config.test.ts`. Rewrite `docs/LOCAL-DEV.md`. Update `README.md` "Local development" section. Append the supersede marker to `add-localstack-dev-env/proposal.md`. Add the CI grep guard that fails the test suite if any sidecar reference is reintroduced.

**Depends on:** PR 2 (compose is trimmed; frontend container is gone; `dev:web` script exists from PR 1).

**Mergeable after:** `pnpm --filter frontend test` green AND `pnpm -w vitest run tests/architecture/` green AND `pnpm -C packages/frontend build` succeeds with `VITE_API_BASE_URL` set AND the dev-server (`pnpm dev:api`) + Vite (`pnpm dev:web`) boot successfully end-to-end against the trimmed compose.

**Capabilities in this PR:** Capability 5 (frontend-http-client, REQ-FHC-1..3), Capability 6 (frontend-vite-env-simplification, REQ-FVE-1..7), Capability 7 (docs-rewrite, REQ-DOC-1..4), Capability 8 (supersede marker, REQ-DOC-3), Capability 9 (CI grep guard, R-7).

---

#### Capability 5: frontend-http-client (REQ-FHC-1..3)

##### Task 5.1: Drop /local fallback in http.ts (REQ-FHC-1)

- [ ] **RED:** `packages/frontend/test/http-base-url.spec.ts` — vitest asserts `http.GET('/products')` resolves to `http://localhost:3001/api/v1/products` when `VITE_API_BASE_URL=http://localhost:3001/api/v1`; assert no `/local` segment anywhere in the resolved URL; assert no `/api/v1/api/v1/...` double-prefixing (REQ-FHC-1 scenarios 1..3).
- [ ] **GREEN:** edit `packages/frontend/src/services/http.ts` — remove `?? 'http://localhost:3001/local'` fallback; base URL reads exclusively from `import.meta.env.VITE_API_BASE_URL` (REQ-FHC-1 contract).
- [ ] **TRIANGULATE:** assert trailing slash in `VITE_API_BASE_URL` is normalized away (EC-1) — `VITE_API_BASE_URL=http://localhost:3001/api/v1/` + `http.GET('/products')` resolves to `http://localhost:3001/api/v1/products` (no `//products`).
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -n 'localhost:3001/local' packages/frontend/src/services/http.ts` returns 0 matches; `pnpm -C packages/frontend dev` boots; HTTP client requests resolve to `${VITE_API_BASE_URL}/products`.
- [ ] **Files:** `packages/frontend/src/services/http.ts` (M), `packages/frontend/test/http-base-url.spec.ts` (C).

##### Task 5.2: Add env-validation Vite plugin (REQ-FHC-2)

- [ ] **RED:** extend `packages/frontend/test/http-base-url.spec.ts` — assert the plugin throws `Error` containing the exact string `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md` when `VITE_API_BASE_URL` is undefined or empty.
- [ ] **GREEN:** create `packages/frontend/vite-plugins/env-validation.ts` — Vite plugin exporting `envValidation()` with a `configResolved` hook that reads `import.meta.env.VITE_API_BASE_URL` + `process.env.VITE_API_BASE_URL` and throws if undefined or empty; error message MUST be exactly `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md`.
- [ ] **TRIANGULATE:** assert the error appears within the first 20 lines of `vite build` output (NFR-2); assert the build exits non-zero; assert the dev server exits non-zero before reporting `ready`.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** with `VITE_API_BASE_URL=""` (or unset), `pnpm -C packages/frontend build` exits non-zero and prints the exact error string within 20 lines.
- [ ] **Files:** `packages/frontend/vite-plugins/env-validation.ts` (C).

##### Task 5.3: No-regression on existing call sites (REQ-FHC-3)

- [ ] **RED:** extend `packages/frontend/test/http-base-url.spec.ts` — assert `http.POST('/auth/login', { username: 'a', password: 'b' })` issues `POST http://localhost:3001/api/v1/auth/login`; assert `http.GET('/products')` issues `GET http://localhost:3001/api/v1/products` with `Authorization: Bearer <jwt>` carried through.
- [ ] **GREEN:** no production change (the new `http.ts` from Task 5.1 already covers this); the test serves as a behavioral lock against future regressions.
- [ ] **TRIANGULATE:** assert the response from the dev server's stubbed auth-lambda handler flows back to the SPA's resolved promise unchanged.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `pnpm --filter frontend test` green; `http.GET('/products')` resolves correctly against the dev-server stub.
- [ ] **Files:** `packages/frontend/test/http-base-url.spec.ts` (M).

#### Capability 6: frontend-vite-env-simplification (REQ-FVE-1..7)

##### Task 6.1: Rewrite vite-env.ts to env-only reads (REQ-FVE-1, FVE-2)

- [ ] **RED:** extend `packages/frontend/test/http-base-url.spec.ts` — assert `packages/frontend/vite-env.ts` imports no `node:fs`/`node:path`/`fs/promises`; assert `readApiBaseUrl` is NOT exported; assert the typed accessor for `VITE_API_BASE_URL` IS exported.
- [ ] **GREEN:** rewrite `packages/frontend/vite-env.ts` — remove `node:fs` import; remove `readApiBaseUrl()` helper; export a typed accessor for `VITE_API_BASE_URL` derived from `import.meta.env.VITE_API_BASE_URL` only.
- [ ] **TRIANGULATE:** assert `ImportMetaEnv.VITE_API_BASE_URL` typing still works (EC-3 — IntelliSense regression check).
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -nE 'node:fs|/shared/\.api-url|readApiBaseUrl' packages/frontend/vite-env.ts` returns 0 matches.
- [ ] **Files:** `packages/frontend/vite-env.ts` (M).

##### Task 6.2: Clean vite.config.ts and load env-validation plugin (REQ-FVE-2 + REQ-FHC-2 wiring)

- [ ] **RED:** extend `packages/frontend/test/http-base-url.spec.ts` — assert `packages/frontend/vite.config.ts` contains NO `readFileSync`, `.api-url`, `/shared/`, or `API_URL_FILE` references; assert the plugins array includes `envValidation()`.
- [ ] **GREEN:** modify `packages/frontend/vite.config.ts` — remove any `readFileSync('/shared/.api-url')` plugin/define; add `envValidation()` to the plugins array.
- [ ] **TRIANGULATE:** assert `pnpm -C packages/frontend dev` boots successfully with `VITE_API_BASE_URL` set and the plugin loaded.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -nE 'readFileSync|\.api-url|/shared/|API_URL_FILE' packages/frontend/vite.config.ts` returns 0 matches.
- [ ] **Files:** `packages/frontend/vite.config.ts` (M).

##### Task 6.3: Delete obsolete vite-config.test.ts (REQ-FVE-3)

- [ ] **RED:** extend `packages/frontend/test/http-base-url.spec.ts` — assert no `readApiBaseUrl` symbol exists anywhere in `packages/frontend/` (`grep -rE 'readApiBaseUrl' packages/frontend/` returns 0).
- [ ] **GREEN:** delete `packages/frontend/test/vite-config.test.ts`.
- [ ] **TRIANGULATE:** assert `test -f packages/frontend/test/vite-config.test.ts` returns non-zero.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** the obsolete 7-test suite pinning `readApiBaseUrl` is gone; `pnpm --filter frontend test` still green.
- [ ] **Files:** `packages/frontend/test/vite-config.test.ts` (D).

##### Task 6.4: tsconfig.node.json include consistency check (REQ-FVE-4)

- [ ] **RED:** `tests/architecture/tsconfig-includes.test.ts` — vitest reads `packages/frontend/tsconfig.node.json`, resolves each entry in `include` (and `exclude` symmetry) against the filesystem, and asserts every path exists (no dangling references to deleted files; no missing entries for `vite-plugins/*.ts`).
- [ ] **GREEN:** if any include is dangling (likely none after the trim — `vite-env.ts` survives), edit `packages/frontend/tsconfig.node.json` to remove it; if `vite-plugins/*.ts` is not covered, add the entry.
- [ ] **TRIANGULATE:** assert `include` covers both `vite.config.ts` and `vite-plugins/*.ts`.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `node -e "JSON.parse(require('fs').readFileSync('packages/frontend/tsconfig.node.json','utf8')).include.flat().every(p => require('fs').existsSync(p))"` returns true.
- [ ] **Files:** `tests/architecture/tsconfig-includes.test.ts` (C), `packages/frontend/tsconfig.node.json` (M only if needed).

##### Task 6.5: Vite cache reset hook on first dev run (REQ-FVE-6)

- [ ] **RED:** covered by the `pnpm dev:reset` smoke assertion in Task 1.10's TRIANGULATE step.
- [ ] **GREEN:** ensure the `dev:reset` script from PR 1 deletes `packages/frontend/node_modules/.vite` (`rm -rf` is idempotent — no-op when path missing).
- [ ] **TRIANGULATE:** assert `pnpm dev:reset` removes the cache directory when it exists; assert the script is a no-op when the cache does not exist.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** after `pnpm dev:reset`, `test -d packages/frontend/node_modules/.vite` returns non-zero.
- [ ] **Files:** `package.json` (M, no-op from PR 1).

##### Task 6.6: .env.development declares VITE_API_BASE_URL (REQ-FNR-3, FVE-7)

- [ ] **RED:** `tests/architecture/frontend-env-declares-url.test.ts` — vitest asserts `packages/frontend/.env.development` contains `VITE_API_BASE_URL=http://localhost:3001/api/v1`; asserts no `s3-proxy` or `API_GATEWAY_HOST_EXTERNAL` references in `.env.development` or `.env.production` (REQ-FNR-3 scenario 2).
- [ ] **GREEN:** edit `packages/frontend/.env.development` to set `VITE_API_BASE_URL=http://localhost:3001/api/v1`.
- [ ] **TRIANGULATE:** assert every `VITE_*` key consumed by the frontend source has a value (no `undefined` resolutions) — REQ-FVE-7.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `cat packages/frontend/.env.development` shows the expected line; no `s3-proxy` / `API_GATEWAY_HOST_EXTERNAL` in either env file.
- [ ] **Files:** `packages/frontend/.env.development` (M).

#### Capability 7: docs-rewrite (REQ-DOC-1..4)

##### Task 7.1: Rewrite docs/LOCAL-DEV.md (REQ-DOC-1 + REQ-DOC-4)

- [ ] **RED:** `tests/architecture/docs-no-sidecar-refs.test.ts` — vitest asserts `docs/LOCAL-DEV.md` does NOT contain `deployer`, `s3-proxy`, `shared-data`, `/shared/\.api-url`, `LOCALSTACK_BIND_HOST`, `API_GATEWAY_HOST_EXTERNAL`, `AWS_ENDPOINT_URL_S3` (REQ-DOC-1 scenario 3).
- [ ] **GREEN:** rewrite `docs/LOCAL-DEV.md` per the cognitive-doc-design skill (lead with `pnpm dev`, sections Prerequisites → First run → What runs where → Troubleshooting → Reset, ≤ 250 lines).
- [ ] **TRIANGULATE:** assert the Troubleshooting section addresses all five failure modes (REQ-DOC-4 scenario 1): (a) stale LocalStack state, (b) stale Vite cache, (c) missing `VITE_API_BASE_URL`, (d) port collisions on 3001/4566/5173/5432, (e) DB not ready when `dev:api` starts. Assert "reset" → finds `pnpm dev:reset` and the list of cleared state (REQ-DOC-4 scenario 2).
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -nE 'deployer|s3-proxy|shared-data|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3' docs/LOCAL-DEV.md` returns 0 matches.
- [ ] **Files:** `docs/LOCAL-DEV.md` (M — full rewrite).

##### Task 7.2: Update README.md "Local development" section (REQ-DOC-2)

- [ ] **RED:** `tests/architecture/readme-no-sidecar-refs.test.ts` — vitest asserts `README.md` does NOT contain any of the removed sidecar terms.
- [ ] **GREEN:** update `README.md` "Local development" section — replace the long-form setup with a one-line summary + a relative link to `docs/LOCAL-DEV.md` (`run pnpm dev — see docs/LOCAL-DEV.md for details`).
- [ ] **TRIANGULATE:** assert the section contains a relative link to `docs/LOCAL-DEV.md`.
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -nE 'deployer|s3-proxy|shared-data|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3' README.md` returns 0 matches.
- [ ] **Files:** `README.md` (M).

#### Capability 8: supersede marker (REQ-DOC-3)

##### Task 8.1: Mark add-localstack-dev-env as superseded (REQ-DOC-3)

- [ ] **RED:** `tests/architecture/supersede-marker.test.ts` — vitest asserts `openspec/changes/add-localstack-dev-env/proposal.md` contains the exact line `## Status: superseded by replace-localstack-dev-server on 2026-07-10` (top-level section, at or near the top).
- [ ] **GREEN:** append the supersede marker line to the proposal file as a new top-level `## Status: ...` section. Do NOT touch the original proposal body.
- [ ] **TRIANGULATE:** assert the original proposal body is intact below the marker (no body rewrite).
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `grep -n 'Status: superseded by replace-localstack-dev-server' openspec/changes/add-localstack-dev-env/proposal.md` returns exactly one match.
- [ ] **Files:** `openspec/changes/add-localstack-dev-env/proposal.md` (M — append only).

#### Capability 9: CI grep guard (R-7 mitigation)

##### Task 9.1: Add architecture grep guard test (R-7)

- [ ] **RED:** `tests/architecture/no-sidecar-refs.test.ts` (extended from Tasks 2.2, 3.2, 4.1) — vitest that recursively greps `packages/`, `scripts/`, `docker-compose.dev.yml`, `docker/`, `docs/`, `README.md`, `.env.dev*` (excluding `node_modules/`, `dist/`, `coverage/`, `openspec/changes/`, `tests/architecture/` itself) for the 8 sidecar tokens (`shared-data`, `API_URL_FILE`, `/shared/\.api-url`, `LOCALSTACK_BIND_HOST`, `API_GATEWAY_HOST_EXTERNAL`, `AWS_ENDPOINT_URL_S3`, `s3-proxy`, `deployer`) and asserts zero matches.
- [ ] **GREEN:** the test passes against the fully trimmed tree (after PRs 1, 2, 3).
- [ ] **TRIANGULATE:** assert re-introducing any of the 8 tokens flips the test to fail — write a temp file with the token into the searched paths, re-run the test, expect failure, then clean up. (Prove the guard is real.)
- [ ] **REFACTOR:** none.
- [ ] **Acceptance:** `pnpm -w vitest run tests/architecture/no-sidecar-refs.test.ts` green; CI integration of this guard is a follow-up (out of scope per `design.md` §11).
- [ ] **Files:** `tests/architecture/no-sidecar-refs.test.ts` (C, with extensions from PR 2/3 tasks).

#### Work-unit commits (PR 3)

- `feat(frontend): drop /local fallback in http.ts (REQ-FHC-1)`
- `feat(frontend): add env-validation Vite plugin (REQ-FHC-2)`
- `refactor(frontend): rewrite vite-env.ts to env-only reads (REQ-FVE-1, FVE-2)`
- `chore(frontend): clean vite.config.ts and delete vite-config.test.ts (REQ-FVE-2, FVE-3)`
- `test(architecture): tsconfig-includes consistency guard (REQ-FVE-4)`
- `chore(frontend): set VITE_API_BASE_URL in .env.development (REQ-FNR-3, FVE-7)`
- `docs: rewrite docs/LOCAL-DEV.md (REQ-DOC-1, DOC-4)`
- `docs: update README.md "Local development" section (REQ-DOC-2)`
- `docs: append supersede marker to add-localstack-dev-env/proposal.md (REQ-DOC-3)`
- `test(architecture): add no-sidecar-refs grep guard (R-7)`

#### Verification gate (PR 3)

- `pnpm --filter frontend test` → green.
- `pnpm -w vitest run tests/architecture/` → green (all 8+ architecture specs).
- `pnpm -C packages/frontend build` (with `VITE_API_BASE_URL` set) → exit 0.
- `pnpm -C packages/frontend build` (with `VITE_API_BASE_URL=""`) → exit non-zero + the exact error string within 20 lines.
- `pnpm dev:api` + `pnpm dev:web` boots successfully end-to-end against the trimmed compose; `curl http://localhost:3001/api/v1/health` returns 200; `curl http://localhost:5173` loads the SPA.
- `pnpm -C packages/frontend dev --force` (cache cleared) + edit `packages/frontend/src/services/http.ts` + save → Vite HMR fires within 500 ms (REQ-FNR-4 NFR-1).
- `grep -nE 'deployer|s3-proxy|shared-data|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3' docs/LOCAL-DEV.md README.md` → 0 matches.
- `grep -n 'Status: superseded by replace-localstack-dev-server' openspec/changes/add-localstack-dev-env/proposal.md` → 1 match.
- `pnpm -w tsc --noEmit` → green.

#### Rollback plan (PR 3)

- `git revert` the merge commit restores the previous `http.ts` fallback, the `vite-env.ts` fs reader, the `vite-config.test.ts`, the old `docs/LOCAL-DEV.md` body, the `README.md` Local development text. The supersede marker stays (additive only). Frontend tests stay green; dev server (from PR 1) keeps working.

<!-- PR BOUNDARY -->

---

## 3. Coverage matrix (REQ → Task)

| Requirement                                      | Source spec                      | Task(s)                                                                       |
| ------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| REQ-NDS-1 (port + /api/v1)                       | native-dev-server                | Task 1.1                                                                      |
| REQ-NDS-2 (LAMBDAS single source of truth)       | native-dev-server                | Task 1.1, 1.4                                                                 |
| REQ-NDS-3 (APIGW v2 event shape)                 | native-dev-server                | Task 1.2, 1.3 (R-1 byte-equality)                                             |
| REQ-NDS-4 (response writeback)                   | native-dev-server                | Task 1.4, 1.9 (cookies)                                                       |
| REQ-NDS-5 (handler throw → 500)                  | native-dev-server                | Task 1.5                                                                      |
| REQ-NDS-6 (unknown route → 404)                  | native-dev-server                | Task 1.4                                                                      |
| REQ-NDS-7 (OPTIONS preflight)                    | native-dev-server                | Task 1.6                                                                      |
| REQ-NDS-8 (/health 200)                          | native-dev-server                | Task 1.7                                                                      |
| REQ-NDS-9 (graceful shutdown + body-size + EC-5) | native-dev-server                | Task 1.8, 1.9, 1.11                                                           |
| REQ-DEM-1 (two services)                         | docker-env-minimal               | Task 2.1                                                                      |
| REQ-DEM-2 (SERVICES trimmed)                     | docker-env-minimal               | Task 2.1                                                                      |
| REQ-DEM-3 (no sidecars)                          | docker-env-minimal               | Task 2.2                                                                      |
| REQ-DEM-4 (no shared-data)                       | docker-env-minimal               | Task 2.1                                                                      |
| REQ-DEM-5 (postgres unchanged)                   | docker-env-minimal               | Task 2.3                                                                      |
| REQ-DEM-6 (deleted files)                        | docker-env-minimal               | Task 2.2                                                                      |
| REQ-EVC-1 (no removed keys)                      | env-vars-cleanup                 | Task 3.1                                                                      |
| REQ-EVC-2 (kept vars present)                    | env-vars-cleanup                 | Task 3.1                                                                      |
| REQ-EVC-3 (no code refs)                         | env-vars-cleanup                 | Task 3.2, 9.1                                                                 |
| REQ-EVC-4 (.env sync)                            | env-vars-cleanup                 | Task 3.1                                                                      |
| REQ-FHC-1 (env-only base URL)                    | frontend-http-client             | Task 5.1                                                                      |
| REQ-FHC-2 (fail loud)                            | frontend-http-client             | Task 5.2                                                                      |
| REQ-FHC-3 (no regression)                        | frontend-http-client             | Task 5.3                                                                      |
| REQ-FVE-1 (env-only reads)                       | frontend-vite-env-simplification | Task 6.1                                                                      |
| REQ-FVE-2 (no vite.config read)                  | frontend-vite-env-simplification | Task 6.2                                                                      |
| REQ-FVE-3 (old test suite removed)               | frontend-vite-env-simplification | Task 6.3                                                                      |
| REQ-FVE-4 (tsconfig consistent)                  | frontend-vite-env-simplification | Task 6.4                                                                      |
| REQ-FVE-5 (docker/frontend/ removed)             | frontend-vite-env-simplification | Task 4.1 (atomic deletion with the rest of the docker trim in PR 2)           |
| REQ-FVE-6 (cache reset)                          | frontend-vite-env-simplification | Task 6.5                                                                      |
| REQ-FVE-7 (env-only config)                      | frontend-vite-env-simplification | Task 6.6                                                                      |
| REQ-FNR-1 (native dev:web)                       | frontend-native-runtime          | Task 1.10 (root script declaration in PR 1)                                   |
| REQ-FNR-2 (no compose frontend service)          | frontend-native-runtime          | Task 4.1                                                                      |
| REQ-FNR-3 (.env.development URL)                 | frontend-native-runtime          | Task 6.6                                                                      |
| REQ-FNR-4 (HMR works)                            | frontend-native-runtime          | Verification gate (PR 3 — Vite native HMR verified by manual save-and-reload) |
| REQ-DOC-1 (one-command boot)                     | docs-rewrite                     | Task 7.1                                                                      |
| REQ-DOC-2 (README link)                          | docs-rewrite                     | Task 7.2                                                                      |
| REQ-DOC-3 (supersede marker)                     | docs-rewrite                     | Task 8.1                                                                      |
| REQ-DOC-4 (troubleshooting)                      | docs-rewrite                     | Task 7.1                                                                      |
| R-1 (event shape drift)                          | proposal §7                      | Task 1.2 + 1.3 (byte-equality)                                                |
| R-7 (stragglers)                                 | proposal §7                      | Task 9.1 + 2.2, 3.2, 4.1 (file-level removals)                                |

---

## 4. Cross-cutting test files (one row per vitest file)

| Vitest file                                            | Covers                                                 | PR    |
| ------------------------------------------------------ | ------------------------------------------------------ | ----- |
| `scripts/dev-server.test.ts`                           | REQ-NDS-1, NDS-2, NDS-4..NDS-9, EC-1, EC-5, R-8        | 1     |
| `scripts/dev-server.event-shape.test.ts`               | REQ-NDS-3 + R-1 byte-equality                          | 1     |
| `packages/frontend/test/http-base-url.spec.ts`         | REQ-FHC-1..3, REQ-FVE-1..3, REQ-FNR-3                  | 3     |
| `tests/architecture/compose-services.test.ts`          | REQ-DEM-1, DEM-2                                       | 2     |
| `tests/architecture/postgres-unchanged.test.ts`        | REQ-DEM-5                                              | 2     |
| `tests/architecture/no-stale-env-keys.test.ts`         | REQ-EVC-1, EVC-4                                       | 2     |
| `tests/architecture/no-sidecar-refs.test.ts`           | REQ-DEM-3, DEM-6, REQ-EVC-3, REQ-FNR-2, REQ-FVE-3, R-7 | 2 + 3 |
| `tests/architecture/tsconfig-includes.test.ts`         | REQ-FVE-4                                              | 3     |
| `tests/architecture/frontend-env-declares-url.test.ts` | REQ-FNR-3, FVE-7                                       | 3     |
| `tests/architecture/docs-no-sidecar-refs.test.ts`      | REQ-DOC-1                                              | 3     |
| `tests/architecture/readme-no-sidecar-refs.test.ts`    | REQ-DOC-2                                              | 3     |
| `tests/architecture/supersede-marker.test.ts`          | REQ-DOC-3                                              | 3     |
| `tests/architecture/scripts-declared.test.ts`          | root scripts + dep pins (PR 1 contract)                | 1     |

---

## 5. Verification checklist (run before declaring done)

Apply order = task order inside each PR; PRs run in order 1 → 2 → 3.

- [ ] **PR 1 merge gate**: `pnpm -w vitest run` green; `pnpm -w tsc --noEmit` green; `tsx scripts/dev-server.ts` boots; `curl http://localhost:3001/api/v1/health` returns 200.
- [ ] **PR 2 merge gate**: `docker compose -f docker-compose.dev.yml config --services` lists exactly `postgres` + `localstack`; `docker compose up -d postgres localstack` succeeds; `pnpm -w vitest run tests/architecture/` green.
- [ ] **PR 3 merge gate**: `pnpm --filter frontend test` green; `pnpm -w vitest run tests/architecture/` green; `pnpm -C packages/frontend build` succeeds with `VITE_API_BASE_URL` set; full PR-1 → PR-2 → PR-3 stack boots end-to-end.
- [ ] **Final smoke (after PR 3)**: `pnpm dev` brings up postgres + localstack + dev server + Vite in one terminal; `curl http://localhost:3001/api/v1/health` returns 200; `curl http://localhost:5173` loads the SPA; `curl -X POST http://localhost:3001/api/v1/auth/login -d '{"username":"admin","password":"admin123"}' -H 'Content-Type: application/json'` returns 200 + JWT (depends on `add-inventory-mvp` having seeded an admin user row).
- [ ] **No AI attribution**: `git log --grep='^Co-authored-by'` empty.
- [ ] **No stale sidecar refs**: `pnpm -w vitest run tests/architecture/no-sidecar-refs.test.ts` green.

---

## 6. Risks from design (cross-reference `design.md` §9)

| ID  | Risk                                        | Mitigation owner     | Task                                                                           |
| --- | ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| R-1 | APIGW v2 event-shape drift (High)           | design + apply       | Task 1.2 (event builder) + Task 1.3 (AWS byte-equality test)                   |
| R-2 | Handler throw uncaught at socket (Medium)   | design + apply       | Task 1.5 (500 DEV_SERVER_ERROR envelope + stderr stack)                        |
| R-3 | LocalStack stale state (Medium)             | docs + dev:reset     | Task 7.1 (Troubleshooting section) + Task 1.10 (`pnpm dev:reset` script)       |
| R-4 | Stale Vite cache (Medium)                   | dev:reset script     | Task 6.5 + Task 1.10                                                           |
| R-5 | Concurrent runner churn (Low)               | pin `^9.0.0`         | Task 1.10 (root deps pin)                                                      |
| R-6 | S3 bucket creation gone (Low)               | docs                 | Task 7.1 (LOCAL-DEV.md "AWS-managed services" subsection)                      |
| R-7 | Shared-data / API_URL_FILE stragglers (Low) | grep guard           | Task 9.1 (no-sidecar-refs.test.ts) + Tasks 2.2, 3.2, 4.1 (file-level removals) |
| R-8 | Body-size threshold misuse (Low)            | design clamp + tests | Task 1.8 (clamp to 1 MiB floor + WARN log)                                     |
| R-9 | `pnpm dev:reset` wipes DB (Low)             | docs warn loud       | Task 7.1 (LOCAL-DEV.md "What's destructive" subsection)                        |

---

## 7. Workload Forecast (per task instructions, explicit)

- **Estimated total LOC (production):** ~210 (`scripts/dev-server.ts` ~150 + `scripts/events/apigw-v2-builder.ts` ~30 + `packages/frontend/vite-plugins/env-validation.ts` ~30).
- **Estimated total LOC (test):** ~520 across 13 vitest files (`scripts/dev-server.test.ts` ~120 + `scripts/dev-server.event-shape.test.ts` ~80 + `packages/frontend/test/http-base-url.spec.ts` ~70 + 10 architecture specs averaging ~25 each).
- **Estimated total LOC (docs/config):** ~210 (`docs/LOCAL-DEV.md` ~200 + `README.md` ~10).
- **Total changed lines:** ~950 (per `design.md` §7.1 file-system estimate; git diff counts both additions and deletions).
- **Chained PRs recommended:** **Yes** — single PR exceeds 400 line budget by 2.4×.
- **400-line budget risk:** **High** (raw file-system diff ~950; each PR in the chain stays ≤ ~435).
- **Decision needed before apply:** **Yes** — confirm chained PRs (per `delivery.strategy = ask-on-risk`); chain strategy default `stacked-to-main` per `config.yaml → delivery.chain_strategy`.

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

---

## Next step

Hand this task list to the `sdd-apply` phase. Apply executes PR 1 first, then PR 2, then PR 3, in dependency order. Each PR uses the `work-unit-commits` skill to keep commits reviewable. The orchestrator surfaces the chained-PR decision to the user before apply starts (per `delivery.strategy = ask-on-risk`).

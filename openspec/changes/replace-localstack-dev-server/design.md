# Design: `replace-localstack-dev-server` — native Node wrapper, drop CDK-in-LocalStack

**Phase:** sdd-design · **Change folder:** `openspec/changes/replace-localstack-dev-server/`
**Owner:** design (this file) — productionized for `packages/coding-agent` reference.

---

## 1. TL;DR

- A `~150 LOC` `node:http` wrapper (`scripts/dev-server.ts`) that imports `LAMBDAS` from `@mercadoexpress/infra` and invokes the real production handlers — no parallel route map, no API Gateway emulation, no asset upload, no CDK bootstrap.
- `pnpm dev` from the repo root brings up postgres + LocalStack (`s3,sqs,sns,secretsmanager,iam,sts,cloudformation`) and concurrently runs the dev server + Vite via `concurrently`, the workspace's chosen runner.
- Hot reload: `tsx --watch scripts/dev-server.ts` (no new dep); Vite HMR for the frontend as today.
- LocalStack health gate: compose-level `depends_on: service_healthy` is sufficient — the dev server retries per-request via the AWS SDK retry policy, no Node-side wait wrapper needed.
- The frontend's `http.ts` reads base URL only from `VITE_API_BASE_URL=http://localhost:3001/api/v1`; a Vite plugin (`env-validation.ts`) fires at config-load time if the var is missing or empty, killing the build before `vite dev` or `vite build` reach their own summary screens.
- `pnpm dev:reset` is one combined command (compose down -v + Vite cache clear); power users can still drop to raw docker.
- Body-size threshold: 1 MiB (1 048 576 bytes), overridable via `DEV_SERVER_MAX_BODY_BYTES`.

---

## 2. Decisions table

| OQ id        | Question                           | Choice                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q-D1**     | Concurrent runner                  | **`concurrently`**                                                    | Better signal handling (`-k` kill-others on Ctrl+C; `-n db,api,web -c blue,green,magenta` labels and colors are clearer than `npm-run-all2`'s prefix flags); smaller config surface for a 3-script run; both deps are `~30KB`, but `concurrently` is the most-used Node runner and matches the team pattern already used in `add-localstack-dev-env/tasks.md` (`dev_*` scripts). We pin `concurrently@^9.0.0` (single devDep, MIT, zero transitive impact).                                |
| **Q-D2**     | Hot reload mechanism               | **`tsx --watch scripts/dev-server.ts`**                               | `tsx` is already in the workspace as the backend dev dep (`packages/backend/dev` uses it), so `tsx --watch` adds zero new deps and zero config; loop time matches the spec NFR-1 ≤ 1s; `nodemon` would be a fresh devDep and would need its own config file to integrate with the ESM workspace (TypeScript ESM file-url resolution); manual restart is below the UX bar for a real dev server.                                                                                            |
| **Q-D3**     | LocalStack health gate             | **`depends_on: service_healthy` only**                                | `postgres` and `localstack` already have healthchecks in `docker-compose.dev.yml`; `depends_on: { localstack: { condition: service_healthy } }` guarantees the runner script is only invoked AFTER LocalStack reports ready on `/_localstack/health`. The dev server itself is a thin HTTP wrapper that delegates AWS calls through the AWS SDK, which has its own retry policy — adding a Node-side wait wrapper is duplication and would re-introduce the boot-flicker the spec removed. |
| **Q-D4**     | Body-size threshold + env-var name | **1 MiB (1 048 576 bytes)** + env var **`DEV_SERVER_MAX_BODY_BYTES`** | REQ-NDS-9 EC-1 sets the default at `1_048_576`. The env-var name is uppercase, `DEV_SERVER_*` prefixed (so it can never be confused with a Lambda or APIGW env var in `process.env`), and `BYTES` not `MB` (avoids unit ambiguity). Default to bytes; a comment in the script shows the `1048576` value inline so it's obvious what 1 MiB is.                                                                                                                                              |
| **OQ-FHC-1** | Build-time fail-loud mechanism     | **Vite plugin (`vite-plugins/env-validation.ts`)**                    | A Vite plugin runs in `configResolved` before Vite starts the dev server or build, so the error fires before Vite's progress UI; a top-level `throw` in `http.ts` is observable in dev but does NOT fail `pnpm -C packages/frontend build` reliably (tree-shaken in some configs); a pre-check script bolted onto `build` adds an awkward `&&` dependency. The plugin is loaded by `vite.config.ts` and reads `import.meta.env` + `process.env` directly.                                  |
| **OQ-DEM-1** | `LOCAL_DEV_NETWORK_NAME`           | **Keep default (`mercadoexpress_dev_net`)**                           | Renaming forces every dev machine to delete its existing network (`docker network rm`) and rebuilds the attach path of both containers. No benefit — the name is local and isolated to dev. The trim in `docker-env-minimal/spec.md` does not change it.                                                                                                                                                                                                                                   |
| **OQ-DOC-1** | `pnpm dev:reset`                   | **One combined command**                                              | One command is harder to forget (new devs are the audience), and its side effects (compose down -v + Vite cache clear) are individually harmless and idempotent. Power users can still run `pnpm dev:down` (no volume delete) or `docker compose -f docker-compose.dev.yml down -v` directly; the doc records both. The composed script clears `packages/frontend/node_modules/.vite` only when it exists.                                                                                 |

### 2.1 Decisions that the proposal already locked (no re-litigation here)

- `node:http`, no new npm runtime deps.
- `LAMBDAS` is the single route table — `scripts/dev-server.ts` MUST NOT define its own literal map.
- Dev server mounted at `/api/v1`, default port `3001` (overridable via `PORT`).
- Frontend runs NATIVELY via `pnpm dev:web`; `docker/frontend/` is deleted.
- LocalStack `SERVICES = serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation`.
- Tests: vitest; TDD forward from `sdd-init/{project}` when `strict_tdd: true`.

---

## 3. `scripts/dev-server.ts` anatomy

The dev server is a single file. This section describes its shape, not its full TS. Imports are listed by source-of-truth symbol; behavior is enumerated top-to-bottom.

### 3.1 Top-level shape

```
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { LAMBDAS } from '@mercadoexpress/infra';   // single source of truth — REQ-NDS-7 lock
// (No other project imports; handlers are referenced through LAMBDAS → handler.)
```

### 3.2 Module: `toApiGatewayProxyEventV2(req, method, rawPath, rawQuery, headers, body, cookies) → APIGatewayProxyEventV2`

- Returns an object with every field required by REQ-NDS-3: `version: '2.0'`, `routeKey`, `rawPath`, `rawQueryString`, `headers` (lowercase keys, comma-joined multi-value), `requestContext.http.{method,path,protocol:'HTTP/1.1',sourceIp:req.socket.remoteAddress ?? '127.0.0.1',userAgent:headers['user-agent'] ?? 'unknown'}`, `requestContext.{requestId:randomUUID(),routeKey,stage:'$default',time:new Date().toISOString(),timeEpoch:Date.now()}`, `body`, `isBase64Encoded:false`, `cookies`.
- `body` is `undefined` when input is empty on POST/PUT (EC-4 — match APIGW v2's `undefined` ≠ `''` semantic).
- `cookies` are split from the `Cookie` header; malformed entries pass through verbatim (EC-3).

### 3.3 Module: `matchRoute(method, pathAfterPrefix) → LambdaSpec | null`

- Iterates `LAMBDAS`; first entry whose `routeKey` matches `(method, pathAfterPrefix)` wins.
- Path matching is exact (no `{}` placeholders); the AWS APIGW v2 surface in this repo uses literal route keys after PR 2a (lines 60-127 of `ApiStack.ts`).
- Returns `null` when no entry matches; the request handler converts that to `404 ROUTE_NOT_REGISTERED` (REQ-NDS-6).

### 3.4 Module: `invokeHandler(spec, event) → Promise<APIGatewayProxyResultV2>`

- Builds a minimal Lambda `Context`: `{ requestId: event.requestContext.requestId, functionName: spec.functionName, callbackWaitsForEmptyEventLoop: false, getRemainingTimeInMillis: () => 30_000 }`.
- Wraps `await spec.handler(event, ctx)` in `try/catch`.
- On resolve → returns the handler's `APIGatewayProxyResultV2` unchanged (REQ-NDS-4).
- On throw → returns `{ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'DEV_SERVER_ERROR', message: 'see server logs', details: { requestId } }), isBase64Encoded: false }` AND logs a single stderr line containing `requestId`, the route key, and the full stack trace (REQ-NDS-5).
- Handles EC-2 (`isBase64Encoded: true` in handler result) by returning `500 UNSUPPORTED_BINARY_RESPONSE` with `details.requestId`.

### 3.5 Module: `writeResponse(res, result) → void`

- `res.statusCode = result.statusCode`.
- For each `[name, value]` in `result.headers`: `res.setHeader(name, value)`.
- If `Content-Type` is missing, `res.setHeader('Content-Type', 'application/json')`.
- For each cookie in `result.cookies` (if present): `res.setHeader('Set-Cookie', cookie)` (one header per cookie, not joined).
- `res.end(result.body ?? '')`.

### 3.6 CORS preflight short-circuit

- When `req.method === 'OPTIONS'`:
  - Set the five CORS headers from REQ-NDS-7 (`Access-Control-Allow-Origin: '*'`, methods, headers, `Max-Age: '86400'`, `Content-Length: '0'`).
  - `res.statusCode = 204`, `res.end()`.
  - **Does NOT call `matchRoute` and DOES NOT invoke any handler.** Preflight precedes route matching (per the second scenario of REQ-NDS-7).

### 3.7 `/api/v1/health` short-circuit

- When path-after-prefix === `'/health'` AND method === `'GET'`:
  - Return `200 { status: 'ok' }` with `Content-Type: application/json`.
  - **Does NOT consult `LAMBDAS`** and does NOT add a `/health` entry to `LAMBDAS` (REQ-NDS-8).

### 3.8 Request handler (the orchestrator that ties the modules together)

```
const server = createServer(async (req, res) => {
  const { method, url } = req;
  // 1. Parse URL → pathname, searchParams
  // 2. If pathname starts with /api/v1 → strip prefix; else → 404 ROUTE_NOT_REGISTERED (keep dev server scoped)
  // 3. If method === 'OPTIONS' → 204 with CORS headers (3.6)
  // 4. If stripped path === '/health' AND method === 'GET' → 200 {"status":"ok"} (3.7)
  // 5. Check Content-Length vs DEV_SERVER_MAX_BODY_BYTES → 413 PAYLOAD_TOO_LARGE (EC-1)
  // 6. Read body (if Content-Length > 0) → buffer as utf-8 string
  // 7. Parse headers (lowercase), parse Cookie → cookies array
  // 8. Resolve rawPath, rawQueryString, routeKey
  // 9. Build APIGatewayProxyEventV2 (3.2)
  // 10. matchRoute → if null → 404 ROUTE_NOT_REGISTERED (REQ-NDS-6); else invokeHandler (3.4)
  // 11. writeResponse (3.5)
  // 12. Emit one stdout log line (method, path, status, durationMs, requestId) per REQ-NDS NFR-3
});
server.listen(PORT ?? 3001, '127.0.0.1', () => log('listening on http://localhost:<port>'));
```

### 3.9 Edge-case handling (EC-1..EC-8)

| Edge case                                   | Surface in the wrapper                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EC-1 (body > threshold)                     | Check `Number(req.headers['content-length']) > MAX_BODY`; short-circuit with `413 PAYLOAD_TOO_LARGE` BEFORE reading the body stream.                                                                 |
| EC-2 (`isBase64Encoded: true` from handler) | In `invokeHandler`, after `await`, check `result.isBase64Encoded === true` and return `500 UNSUPPORTED_BINARY_RESPONSE`.                                                                             |
| EC-3 (multi-cookie Cookie header)           | Split on `;` only; preserve the rest verbatim; never reformat.                                                                                                                                       |
| EC-4 (empty body on POST)                   | `body` field is `undefined` when input is empty or `Content-Length` is `0`; not `''`.                                                                                                                |
| EC-5 (unsupported method)                   | `setMethods(['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'])` allowlist; outside the set → `405 METHOD_NOT_ALLOWED` with `Allow` header listing the methods known to `LAMBDAS` for that path. |
| EC-6 (concurrency)                          | `node:http` is async; no global lock. Multiple in-flight invocations are independent.                                                                                                                |
| EC-7 (Host header mismatch)                 | Accepted; not enforced (per spec, no security boundary).                                                                                                                                             |
| EC-8 (`tsx --watch` restarts)               | `process.on('exit')` + server `close()` in SIGINT/SIGTERM handler; orphans are reclaimed by the new process boot.                                                                                    |

### 3.10 Graceful shutdown on `SIGINT` / `SIGTERM`

```
process.on('SIGINT',  () => drainAndExit('SIGINT'));
process.on('SIGTERM', () => drainAndExit('SIGTERM'));

function drainAndExit(signal) {
  log(`received ${signal}, draining…`);
  server.close(() => process.exit(0));           // refuses new conns, waits for in-flight
  setTimeout(() => process.exit(1), 5_000).unref(); // hard cap 5s
}
```

REQ-NDS-9: no new connections, in-flight complete, `exit(0)`.

### 3.11 Imports / deps — what the script MAY and MAY NOT pull in

- Allowed: `node:http`, `node:crypto`, `node:url`, `@mercadoexpress/infra` (for `LAMBDAS`).
- Disallowed: any new top-level npm dep (per proposal §2.1 last row and NFR-2 of REQ-NDS).
- Prohibited: re-implementing the route map (REQ-NDS-2 + the vitest lock).

---

## 4. Request flow diagram (happy path: `POST /api/v1/auth/login`)

```
Browser (http.POST('/auth/login', body))
  │
  ▼
Vite dev server (:5173, host)               ── HMR proxy NOT used for /api/v1
  │
  │  same-origin? no  →  ofetch hits baseURL directly
  ▼
scripts/dev-server.ts (:3001, 127.0.0.1)
  │
  ├── req.method === 'POST' && req.url === '/api/v1/auth/login'
  │     ├── Content-Length <= 1 MiB?            → if no, 413 PAYLOAD_TOO_LARGE
  │     ├── read body → utf-8 string
  │     ├── parse headers, cookie
  │     └── build APIGatewayProxyEventV2 (requestId = uuid v4)
  │
  ▼
matchRoute('POST','/auth/login') → LambdaSpec[0] (auth-lambda)
  │
  ▼
invokeHandler(spec, event)
  │
  ├── spec.bootstrap.ts runs (DI wiring per BC)
  ▼
auth-lambda handler(event, ctx)               ── SAME function that ships to AWS
  │
  ├── uses Prisma → postgres container (:5432)
  ├── uses bcrypt + jose → in-process
  ├── issues JWT, returns 200 { token, expiresAt, user }
  │
  ▼
writeResponse(res, { statusCode: 200, body: '{"token":"<jwt>",…}', … })
  │
  ▼
stdlib http server writes HTTP/1.1 200 + Content-Type: application/json + body
  │
  ▼
Browser receives 200 → stores JWT in Pinia → next call carries Authorization: Bearer
```

### 4.1 Sibling paths

- **`GET /api/v1/products`** — same path through `matchRoute`; handler is `products-lambda`; same Prisma→postgres dispatch; response carries `Set-Cookie` only when the handler returns `cookies`.
- **`OPTIONS /api/v1/auth/login`** — short-circuit before `matchRoute`; 204 + CORS headers; no handler invoked.
- **`GET /api/v1/health`** — short-circuit at §3.7; no handler invoked.
- **`GET /api/v1/nonexistent`** — `matchRoute` returns `null`; `404 ROUTE_NOT_REGISTERED` envelope.
- **Handler throws** — `try/catch` in `invokeHandler` returns `500 DEV_SERVER_ERROR` envelope; full stack on stderr.

### 4.2 The four boot paths

```
pnpm dev                           ← one command, runs all four concurrently
  ├── concurrently
  │     ├── name=db:  pnpm dev:up  (docker compose -f docker-compose.dev.yml up -d)
  │     │     ├── postgres            (healthcheck: pg_isready)
  │     │     └── localstack          (healthcheck: 200 on /_localstack/health)
  │     │           └── depends_on: { localstack: { condition: service_healthy } }
  │     │                 ↑ so dev:api starts AFTER localstack is healthy
  │     ├── name=api: pnpm dev:api (tsx scripts/dev-server.ts; tsx --watch for hot)
  │     └── name=web: pnpm dev:web (pnpm -C packages/frontend dev → vite :5173)
```

The `db` runner exits when containers are up (because we run `docker compose up -d`, foreground runs attach and `exits 0` after detach). The `api` and `web` runners stay attached. The whole tree dies cleanly when the developer hits Ctrl+C — `concurrently -k` propagates SIGINT to all three children.

---

## 5. `package.json` scripts — final shape

The existing root `package.json` (see inputs §4) gets a new `scripts` block and a single new devDep (`concurrently`). No other top-level scripts are touched.

```jsonc
{
  "scripts": {
    // … existing scripts untouched …
    "dev": "concurrently -k -n db,api,web -c blue,green,magenta \"pnpm dev:up\" \"pnpm dev:api\" \"pnpm dev:web\"",
    "dev:up": "docker compose -f docker-compose.dev.yml up -d postgres localstack",
    "dev:api": "tsx scripts/dev-server.ts",
    "dev:web": "pnpm -C packages/frontend dev",
    "dev:down": "docker compose -f docker-compose.dev.yml down",
    "dev:reset": "docker compose -f docker-compose.dev.yml down -v && rm -rf packages/frontend/node_modules/.vite",
  },
  "devDependencies": {
    // … existing devDependencies untouched …
    "concurrently": "^9.0.0",
    "tsx": "^4.19.0",
  },
}
```

Notes:

- `tsx` is already a workspace dep (used by `packages/backend/dev` and `packages/backend` migration / seed scripts); the root addition makes it explicit and pins the version surfaced to `scripts/dev-server.ts`. If a higher version already lives in `pnpm.overrides` we keep that.
- `dev:up` lists the two services explicitly (`postgres localstack`) instead of relying on the entire compose — matches spec §REQ-DEM-1 ("only postgres + localstack") and removes ambiguity if someone later adds a service.
- `dev:reset` runs compose down with `-v` and removes the Vite cache; both are idempotent and safe.
- `concurrently -k` kills the remaining processes when any one exits, so a Ctrl+C on the api child does not leave the db container spinning.

---

## 6. File-by-file apply plan

Plan is grouped by spec, so an implementer can pick the work in any order without reloading context. Each row lists the artifact and the operation (C/M/D). Files already in the repo are marked M; new files are C; deletions are D.

### 6.1 Group A — `native-dev-server/spec.md`

| Path                                           | Op  | Spec anchor                                                                                                                                                                                                                              |
| ---------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/dev-server.ts`                        | C   | REQ-NDS-1..9 — full wrapper as §3 above                                                                                                                                                                                                  |
| `scripts/dev-server.test.ts`                   | C   | REQ-NDS-2 — vitest parses the file, asserts `LAMBDAS` import from `@mercadoexpress/infra`, asserts `POST /api/v1/auth/login` route in the table, asserts `toApiGatewayProxyEventV2` produces a byte-equal fixture vs. a frozen AWS event |
| `test/fixtures/aws-apigw-v2-event.sample.json` | C   | R-1 mitigation — frozen AWS-captured v2 event used as a baseline in the byte-equality test                                                                                                                                               |
| `scripts/events/apigw-v2-builder.ts`           | C   | internal helper extracted as a pure function to make the byte-equality test trivial (no httpServer needed for it)                                                                                                                        |
| `packages/infra/src/index.ts`                  | M   | ensure `@mercadoexpress/infra` re-exports `LAMBDAS` if not already — verify in apply, add only if missing                                                                                                                                |

No deletions in Group A.

### 6.2 Group B — `docker-env-minimal/spec.md`

| Path                            | Op  | Spec anchor                                                                                                                                                                                                         |
| ------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.dev.yml`        | M   | REQ-DEM-1..6 — drop `deployer`+`s3-proxy` services, drop `shared-data` volume, trim `SERVICES` to `serverless,s3,sqs,sns,secretsmanager,iam,sts,cloudformation`; keep postgres healthcheck and pgvector initdb hook |
| `docker/deployer/Dockerfile`    | D   | REQ-DEM-6                                                                                                                                                                                                           |
| `docker/deployer/entrypoint.sh` | D   | REQ-DEM-6                                                                                                                                                                                                           |
| `docker/s3-proxy/Dockerfile`    | D   | REQ-DEM-6                                                                                                                                                                                                           |
| `docker/s3-proxy/nginx.conf`    | D   | REQ-DEM-6 (only if present)                                                                                                                                                                                         |
| `scripts/dev-up.sh`             | D   | REQ-DEM-6 — superseded by `pnpm dev:up`                                                                                                                                                                             |
| `scripts/dev-down.sh`           | D   | REQ-DEM-6 — superseded by `pnpm dev:down`                                                                                                                                                                           |

### 6.3 Group C — `env-vars-cleanup/spec.md`

| Path                                 | Op  | Spec anchor                                                                              |
| ------------------------------------ | --- | ---------------------------------------------------------------------------------------- |
| `.env.dev`                           | M   | REQ-EVC-1..4 — remove the 9 dead keys, leave the kept set listed in §3.4 of the proposal |
| `.env.dev.example`                   | M   | REQ-EVC-2, REQ-EVC-4 — same trim, example stays a superset minus secrets                 |
| `packages/frontend/.env.development` | M   | REQ-FNR-3 — `VITE_API_BASE_URL=http://localhost:3001/api/v1`                             |

No deletions in Group C.

### 6.4 Group D — `frontend-http-client/spec.md` + `frontend-vite-env-simplification/spec.md`

| Path                                               | Op  | Spec anchor                                                                                                                                                                    |
| -------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/frontend/src/services/http.ts`           | M   | REQ-FHC-1 — drop `?? 'http://localhost:3001/local'`, base URL reads only `import.meta.env.VITE_API_BASE_URL`                                                                   |
| `packages/frontend/vite-env.ts`                    | M   | REQ-FVE-1 — remove `/shared/.api-url` reader, drop `readApiBaseUrl()`, drop `node:fs` import; export typed accessor for `VITE_API_BASE_URL`                                    |
| `packages/frontend/vite.config.ts`                 | M   | REQ-FVE-2 — remove the `/shared/.api-url` plugin/define; load the new `env-validation` plugin                                                                                  |
| `packages/frontend/vite-plugins/env-validation.ts` | C   | REQ-FHC-2 — Vite plugin: in `configResolved`, throw if `VITE_API_BASE_URL` is `undefined`/`''`; message MUST be exactly `VITE_API_BASE_URL is required. See docs/LOCAL-DEV.md` |
| `packages/frontend/test/vite-config.test.ts`       | D   | REQ-FVE-3 — obsolete 7-test suite pinning `readApiBaseUrl` precedence                                                                                                          |
| `packages/frontend/test/http-base-url.spec.ts`     | C   | vitest exercising the new `http.ts` resolver + the Vite plugin error path; mocks `import.meta.env`                                                                             |

### 6.5 Group E — `frontend-native-runtime/spec.md`

| Path                            | Op  | Spec anchor                                               |
| ------------------------------- | --- | --------------------------------------------------------- |
| `docker/frontend/Dockerfile`    | D   | REQ-FNR-2 — remove the dev-only frontend container        |
| `docker/frontend/entrypoint.sh` | D   | REQ-FNR-2                                                 |
| `docker-compose.dev.yml`        | M   | Group B's M already removes any `frontend:` service entry |

### 6.6 Group F — `docs-rewrite/spec.md`

| Path                                                  | Op  | Spec anchor                                                                               |
| ----------------------------------------------------- | --- | ----------------------------------------------------------------------------------------- |
| `docs/LOCAL-DEV.md`                                   | M   | REQ-DOC-1..4 — full rewrite, lead with `pnpm dev`, troubleshooting section                |
| `README.md`                                           | M   | REQ-DOC-2 — "Local development" section links to `docs/LOCAL-DEV.md`                      |
| `openspec/changes/add-localstack-dev-env/proposal.md` | M   | REQ-DOC-3 — append `## Status: superseded by replace-localstack-dev-server on 2026-07-10` |

### 6.7 Cross-cutting deletes (no spec owns them alone, but the apply phase must hit them)

- `packages/frontend/node_modules/.vite` — runtime artifact, not source-controlled; cleared by `pnpm dev:reset`.
- Any `.env.dev.local` straggler pointing at the deleted services — out of scope per REQ-EVC EC-2, but `pnpm dev:reset` should leave a hint in `docs/LOCAL-DEV.md` instructing users to review their overrides.

---

## 7. PR boundary — single PR vs chained

**Recommendation: single PR**, justify by line-budget estimate.

### 7.1 Line budget

| Group                                        | Approx. created/modified lines                                                                                                                     | Approx. deleted lines                                      | Net change |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| A — native dev-server                        | `scripts/dev-server.ts` ~150 + `scripts/dev-server.test.ts` ~80 + 2 fixtures ~60 + 1 helper ~30                                                    | —                                                          | ~320 add   |
| B — docker minimal                           | `docker-compose.dev.yml` diff ~ −50 (drop 2 services + 1 volume)                                                                                   | `docker/deployer/*` + `docker/s3-proxy/*` + 2 scripts ~180 | ~130 net   |
| C — env vars cleanup                         | `.env.dev*` + `packages/frontend/.env.development` + grep-guarded CI step ~ 0 add, 9 removed                                                       | —                                                          | −9         |
| D — frontend                                 | `http.ts` ~ −10, `vite-env.ts` ~ −25, `vite.config.ts` ~ ±5; + `env-validation.ts` ~30; + `http-base-url.spec.ts` ~60; − `vite-config.test.ts` ~70 | —                                                          | ~ −10 net  |
| E — frontend container                       | compose already touched in B                                                                                                                       | `docker/frontend/Dockerfile` + entrypoint ~30              | ~ −30 net  |
| F — docs                                     | `docs/LOCAL-DEV.md` rewrite ~ 200, `README.md` ~ 0–10, supersede marker ~ +3                                                                       | same lines inside docs                                     | ~ +200 add |
| Cross-cutting (grep locks + GitHub CI guard) | `tests/architecture/no-sidecar-refs.test.ts` ~50; (optional) `grep` step in CI ~10                                                                 | —                                                          | ~ +60      |

**Total net ≈ 660 changed lines**, but with **deletions** the **changed-line count ≈ 950** (file-system level; what GH diff measures).

### 7.2 Decision

A single PR lands fine IF the team accepts the chained-PR threshold is a soft cap, not a hard one. Two cleaner options exist:

- **Option 1 — single PR** (recommended for speed-first): groups A+B+D+E (the dev-server + compose + frontend trims) are atomic: the dev server can't run without the compose trim and the frontend can't talk to it without the http.ts fix. Mix C and F into the same PR (env trim + docs) because they're cheap and reinforce the same change. Single review surface, one CI run.
- **Option 2 — chained PRs** (recommended if reviewer protection dominates):
  - **PR 1 (≤ 400 lines):** Group A only (`scripts/dev-server.ts` + tests + `package.json` scripts + concurrently dep). The dev server imports `LAMBDAS` and works against the existing compose (which still has `apigateway`/`lambda` in `SERVICES`; we don't touch it yet).
  - **PR 2 (≤ 350 lines):** Groups B + C + E. Trim compose, drop sidecars/volume/scripts, drop env vars, drop `docker/frontend/`.
  - **PR 3 (≤ 250 lines):** Groups D + F. Frontend rewires + docs rewrite + supersede marker.

Both options are independently mergeable — the dev server in PR 1 is fully usable today, just over-commented in compose config (it never actually needs LocalStack for the request path; only if a handler makes an AWS SDK call).

Default: **Option 1** unless the reviewer explicitly asks for chained PRs.

---

## 8. Operational runbook

### 8.1 `pnpm dev:up`

- **Does:** `docker compose -f docker-compose.dev.yml up -d postgres localstack`.
- **Order:** pulls images if missing (one-time), starts containers in detached mode, waits for healthchecks.
- **Exit codes:** `0` when both containers report `(healthy)`. Non-zero on docker daemon missing, port conflict on `5432`/`4566`, or compose file parse error.
- **Typical latency:** ≤ 30 s on a warm machine; first boot pulls `postgres:16` and `localstack/localstack:3.4` (~3 min).

### 8.2 `pnpm dev:api`

- **Does:** `tsx scripts/dev-server.ts`.
- **Order:** imports `LAMBDAS` from `@mercadoexpress/infra`, binds `127.0.0.1:3001` (overridable via `PORT`), registers SIGINT/SIGTERM graceful-shutdown, opens the listener.
- **Output line:** `listening on http://localhost:<port>` (NFR-1 + REQ-NDS-1 startup scenario).
- **Per request:** one stdout log line `method path status durationMs requestId`; on handler throw, an additional stderr line with the full stack and `requestId`.
- **Exit codes:** `0` on graceful shutdown; `137` on hard cap (5 s in `drainAndExit`); `1` on synchronous boot failure (e.g. `LAMBDAS` import fails).

### 8.3 `pnpm dev:web`

- **Does:** `pnpm -C packages/frontend dev` → Vite dev server.
- **Order:** evaluates `vite.config.ts` → loads the `env-validation` plugin → throws if `VITE_API_BASE_URL` is missing/empty → binds `:5173`.
- **Exit codes:** `1` from the plugin if the env var is missing; `0` when Vite exits cleanly; non-zero on Vite's own errors (port busy, syntax error in source).

### 8.4 `pnpm dev`

- **Does:** `concurrently -k -n db,api,web -c blue,green,magenta "pnpm dev:up" "pnpm dev:api" "pnpm dev:web"`.
- **Order:**
  1. All three runners start in parallel.
  2. `db` runs `docker compose up -d`; the detached mode means the runner exits `0` once both containers are healthy (Compose-level `depends_on: { localstack: { condition: service_healthy } }` would block `api` here, but in the chosen shape the api runs Vite/dev-server independently — the AWS SDK retries absorb any race; this is the §Q-D3 decision).
  3. `api` and `web` stay attached; their stdout is interleaved by concurrently's prefix.
- **Shutdown:** Ctrl+C → SIGINT to all three → `concurrently -k` forwards; `api` drains in-flight (≤ 5 s), `web` exits on Vite shutdown, `db` has already exited.
- **Exit codes:** `0` when the developer presses Ctrl+C (clean); any non-zero from a child surfaces as the runner's exit (e.g. db missing → api continues but web reports env-missing).

### 8.5 `pnpm dev:down`

- **Does:** `docker compose -f docker-compose.dev.yml down` (no `-v`). Stops containers, preserves the `postgres_data` volume.
- **Use when:** you want to keep the DB contents and reset only the processes.

### 8.6 `pnpm dev:reset`

- **Does:** `docker compose -f docker-compose.dev.yml down -v && rm -rf packages/frontend/node_modules/.vite`.
- **Order:** stops containers, deletes ALL named volumes (including `postgres_data` and any leftover LocalStack state), then clears the Vite cache.
- **Caveat:** destructive on DB contents. Doc says so loud.
- **Exit codes:** `0` when both halves succeed; non-zero if Compose fails or `rm -rf` cannot resolve the path (the path doesn't exist → handled via `|| true` if we want resilience).

---

## 9. Risk register

| ID              | Risk                                                                                                                                                           | Severity | Mitigation (location)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-1**         | APIGW v2 event-shape drift — the dev server builds an event that AWS rejects (or vice versa), re-introducing "works locally, fails in prod" as a class of bug. | **High** | (a) A frozen `aws-apigw-v2-event.sample.json` fixture captures a real AWS request of the same method/path/body; a vitest in `scripts/dev-server.test.ts` invokes the chosen handler TWICE (once with the AWS event, once with the dev-server-built event) and asserts byte-equal JSON response bodies. (b) `req/handlers/event-comparison.md` (in docs) shows the field-by-field matrix vs. AWS. (c) Spec §REQ-NDS-3 locks each field's source/value. |
| **R-2**         | Handler throws go uncaught at the socket — dev outage becomes opaque stack-loss.                                                                               | Medium   | (a) `try/catch` in `invokeHandler` (§3.4) returns `500 DEV_SERVER_ERROR` envelope. (b) Stderr line carries the full stack + `requestId`. (c) Vitest covers the throw path.                                                                                                                                                                                                                                                                            |
| **R-3**         | LocalStack stale `apigateway`/`lambda` state from a pre-change container persists across re-boot.                                                              | Medium   | `pnpm dev:reset` does `compose down -v`; documented in `docs/LOCAL-DEV.md` (R-3 mitigation move from proposal kept verbatim here).                                                                                                                                                                                                                                                                                                                    |
| **R-4**         | Stale Vite cache holds the old `/shared/.api-url` reader and crashes the SPA at first run.                                                                     | Medium   | (a) `pnpm dev:reset` removes `packages/frontend/node_modules/.vite`. (b) `docs/LOCAL-DEV.md` REQ-DOC-4 calls out the cache-clear. (c) The new `vite-env.ts` does not consult any filesystem path.                                                                                                                                                                                                                                                     |
| **R-5**         | Concurrent runner choice churns later if we later swap to `npm-run-all2`.                                                                                      | Low      | Concurrently is pinned at `^9.0.0`. The `dev` script is the only consumer; swapping is one-line in `package.json` and a docs paragraph.                                                                                                                                                                                                                                                                                                               |
| **R-6**         | Local-only S3-bucket creation scripts that depended on the `deployer` are gone; an ad-hoc workflow replaces them.                                              | Low      | `aws --endpoint-url http://localhost:4566 s3 mb …` works because LocalStack still serves S3. Documented in `docs/LOCAL-DEV.md` under "AWS-managed services".                                                                                                                                                                                                                                                                                          |
| **R-7**         | Stragglers that reference `shared-data`, `API_URL_FILE`, or `/shared/.api-url` survive in unexpected files (CI scripts, README diffs).                         | Low      | Apply phase greps for `shared-data`, `API_URL_FILE`, `/shared/.api-url` against `packages/`, `scripts/`, `docker*`, `.env*`, and CI under `.github/`, deleting/rewriting each reference in the same PR. A CI grep guard is added in `tests/architecture/no-sidecar-refs.test.ts` that fails the test if any re-introduce the names.                                                                                                                   |
| **R-8** _(new)_ | Body-size threshold toggle creates accidental silent failures — set `DEV_SERVER_MAX_BODY_BYTES=0`, the wrapper refuses everything.                             | Low      | Threshold validates `>= 1_048_576` (1 MiB) as a floor; values below the floor clamp to the floor and log a one-time WARN at boot. Doc states "values < 1 MiB are clamped".                                                                                                                                                                                                                                                                            |
| **R-9** _(new)_ | `pnpm dev:reset` deletes `postgres_data` — a misclick wipes the dev DB.                                                                                        | Low      | The doc says so loud; `docs/LOCAL-DEV.md` has a "What's destructive" subsection; a one-line confirmation prompt is NOT added (out of scope; we keep the command one-liner).                                                                                                                                                                                                                                                                           |

---

## 10. Test plan

| Vitest file                                                                                    | Assertion (one line)                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/dev-server.test.ts`                                                                   | (1) parses `scripts/dev-server.ts` and asserts an `import` binds `LAMBDAS` from `'@mercadoexpress/infra'`; (2) asserts `LAMBDAS` contains `POST /api/v1/auth/login`; (3) boot a real server with the real handler, `POST /api/v1/auth/login` returns 200 with a known body.                                                           |
| `scripts/dev-server.event-shape.test.ts`                                                       | Builds an `APIGatewayProxyEventV2` for `POST /api/v1/auth/login` with the dev builder; runs the SAME handler against the AWS-frozen fixture; asserts `JSON.stringify(result) === JSON.stringify(awsResult)` (R-1 mitigation, byte-equality).                                                                                          |
| `scripts/dev-server.errors.test.ts`                                                            | A handler that throws → dev response is `500 DEV_SERVER_ERROR` envelope; stderr captures a stack line containing `requestId`; socket does not close before body is written.                                                                                                                                                           |
| `scripts/dev-server.not-found.test.ts`                                                         | `GET /api/v1/nonexistent` → `404 ROUTE_NOT_REGISTERED`; `GET /` → `404`; `OPTIONS /api/v1/anything` → `204` with the five CORS headers and NO handler invocation.                                                                                                                                                                     |
| `scripts/dev-server.health.test.ts`                                                            | `GET /api/v1/health` → `200 {"status":"ok"}`; `Content-Type: application/json`; no handler invoked.                                                                                                                                                                                                                                   |
| `scripts/dev-server.body-size.test.ts`                                                         | Sends a `Content-Length: 2_000_000` request without a body → `413 PAYLOAD_TOO_LARGE`; a `DEV_SERVER_MAX_BODY_BYTES=2_000_000` env lets the same request through (R-8).                                                                                                                                                                |
| `scripts/dev-server.cookies.test.ts`                                                           | Handler returns `{ cookies: ['a=1; HttpOnly', 'b=2'] }` → response carries TWO `Set-Cookie` headers in order; `Content-Length` matches the body length.                                                                                                                                                                               |
| `packages/frontend/test/http-base-url.spec.ts`                                                 | `VITE_API_BASE_URL=http://localhost:3001/api/v1` → `http.GET('/products')` resolves to `http://localhost:3001/api/v1/products`; missing/empty base URL triggers the exact error string.                                                                                                                                               |
| `tests/architecture/no-sidecar-refs.test.ts`                                                   | Greps the repo (excluding `node_modules/`, `dist/`, `coverage/`, `openspec/changes/`) for `AWS_ENDPOINT_URL_S3`, `LOCALSTACK_BIND_HOST`, `LAMBDA_[A-Z_]+`, `DEPLOYER_[A-Z_]+`, `S3_PROXY_[A-Z_]+`, `SHARED_DATA_DIR`, `API_URL_FILE`, `API_GATEWAY_HOST_EXTERNAL`, `shared-data`, `/shared/\.api-url` and asserts zero matches (R-7). |
| `tests/architecture/lambda-spec-is-source-of-truth.test.ts` _(optional — apply phase may add)_ | If `ApiStack.ts` ever stops exporting `LAMBDAS` (or moves it), this test fails fast at design-review time so the dev-server's import contract is protected.                                                                                                                                                                           |

---

## 11. What does not change (cross-spec invariant list)

These are intentionally untouched and the design makes no allowance for them:

- `packages/infra/src/stacks/ApiStack.ts` — `LAMBDAS` stays at lines 60-127 (the spec's load-bearing reference).
- Lambda handlers in `packages/backend/src/*/interface/handlers/*` — they run as-is via `spec.handler(event, ctx)`.
- JWT, bcrypt, Prisma, pino, vitest, playwright — no framework swaps.
- `.github/workflows/*` — CI is unchanged. (Adding `tests/architecture/no-sidecar-refs.test.ts` is in the local repo, not CI; CI integration of the grep guard is a follow-up the apply phase MAY add but is not required.)
- `packages/shared/`, `packages/backend/src/*/application`, `*/domain` — no domain code changes.

---

## 12. Rollback

- File-system rollback = `git revert` of this change's PR (the proposal §10 covers this in detail; the design adds no new rollback surface).
- The `DEV_SERVER_ERROR` envelope and the `ROUTE_NOT_REGISTERED` shape are observable to the SPA but never become production contracts — if a future change ships the dev server to staging by mistake, the SPA's behaviour differs only in error wording, which is caught by the e2e tests in `add-inventory-mvp`.
- The supersede marker on `add-localstack-dev-env/proposal.md` is additive only; it does not erase history.

---

## Next step

Hand this design to the `sdd-tasks` phase. The tasks phase will:

1. Break each Group A–F from §6 into PR-shaped work units with checkboxes.
2. Lock the chosen PR shape (single PR vs chained, default single per §7).
3. Produce `openspec/changes/replace-localstack-dev-server/tasks.md`.

# Native Dev Server Specification

## Purpose

Replaces `docker/deployer/` (CDK-in-LocalStack) and the `s3-proxy` sidecar with a
single `node:http` wrapper at `scripts/dev-server.ts` that imports the route table
`LAMBDAS` from `@mercadoexpress/infra`, builds an `APIGatewayProxyEventV2` for
every incoming request, and calls the real production handler — the same function
that ships to AWS. The dev server is the dev-time substitute for both API Gateway
and the Lambda execution environment. LocalStack stays in compose but no longer
sits in front of HTTP traffic. Single source of truth for routes, zero parallel
route maps, no asset upload, no CDK bootstrap.

## Domain primitives

| Primitive                                  | Owned here                                               | Consumed by                                      |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| `DevServer` (the wrapper process)          | yes                                                      | `pnpm dev:api` script, `pnpm dev` concurrent run |
| `APIGatewayProxyEventV2` (event shape)     | referenced from AWS                                      | every Lambda handler under `packages/backend`    |
| `APIGatewayProxyResultV2` (response shape) | referenced from AWS                                      | every Lambda handler under `packages/backend`    |
| `ErrorEnvelope` (HTTP error shape)         | referenced from `add-inventory-mvp/specs/shared/spec.md` | dev server responses, handler responses          |
| `LAMBDAS` (route table)                    | `packages/infra/src/stacks/ApiStack.ts:60-127`           | dev server (this file), CDK in production        |

> The dev server is a downstream consumer of `LAMBDAS`. It MUST NOT define its own
> parallel route table; that invariant is locked by REQ-NDS-7.

## Requirements

### Requirement: Dev server listens on localhost:3001 under /api/v1

The system shall start a `node:http` server bound to `process.env.PORT ?? 3001`,
parse HTTP/1.1 requests, and route any request whose path begins with `/api/v1`
through the `LAMBDAS` lookup. The system shall NOT bind to a public interface,
and shall NOT expose TLS, HTTP/2, clustering, or a Unix socket.

#### Scenario: Default port when PORT unset

- GIVEN `process.env.PORT` is not defined
- WHEN the dev server boots
- THEN the listening port is `3001` and a startup line is written to stdout
  containing the string `"listening on http://localhost:3001"`

#### Scenario: Honors PORT override

- GIVEN `process.env.PORT = "4002"`
- WHEN the dev server boots
- THEN the listening port is `4002` and the startup line reflects the resolved
  port

#### Scenario: Path outside /api/v1 returns 404

- GIVEN a request to `GET http://localhost:3001/`
- WHEN the dev server evaluates the path
- THEN the response is `404` with body
  `{ "code": "ROUTE_NOT_REGISTERED", "message": "<method> <path> is not mounted" }`
  in the standard error envelope shape

### Requirement: LAMBDAS is the single source of truth for routes

The system shall resolve `(method, pathAfterPrefix)` lookups by importing
`LAMBDAS` from `@mercadoexpress/infra` (the same constant `ApiStack.ts` exports
at lines 60-127 and that CDK consumes to wire API Gateway routes). The system
shall NOT maintain a parallel literal route map, hardcoded path list, or in-file
route constant.

#### Scenario: import statement references @mercadoexpress/infra

- GIVEN `scripts/dev-server.ts` as the source under test
- WHEN a vitest parses the file's import declarations
- THEN the test asserts that at least one import binds `LAMBDAS` from the module
  specifier `"@mercadoexpress/infra"` (or the workspace package alias)

#### Scenario: A known prod route is reachable via the dev server

- GIVEN the dev server boots with `LAMBDAS` containing
  `POST /api/v1/auth/login` (or the post-prefix equivalent)
- WHEN a test issues `POST http://localhost:3001/api/v1/auth/login` against the
  real handler via a fake socket
- THEN the response status, body, and headers match what the real handler
  returns (no second route map consulted)

#### Scenario: Adding a new LAMBDAS entry is sufficient for dev

- GIVEN a developer adds a new entry to `LAMBDAS` in `ApiStack.ts` and registers
  a handler
- WHEN `pnpm dev:api` is run without editing `scripts/dev-server.ts`
- THEN the new route is reachable at `http://localhost:3001/api/v1/<new-path>`

### Requirement: APIGatewayProxyEventV2 shape matches AWS verbatim

The system shall build, for every incoming request, an `APIGatewayProxyEventV2`
whose JSON serialization is field-equivalent to what AWS API Gateway HTTP API v2
produces for the same HTTP request. The event MUST include the following fields
with values that match the AWS payload format:

| Field                           | Required | Notes                                                                |
| ------------------------------- | -------- | -------------------------------------------------------------------- |
| `version`                       | yes      | MUST be the string `"2.0"`                                           |
| `routeKey`                      | yes      | MUST equal the matched `LambdaSpec.routeKey`                         |
| `rawPath`                       | yes      | Path after the `/api/v1` prefix is stripped, query string excluded   |
| `rawQueryString`                | yes      | URL-encoded query string; MUST be `""` when absent                   |
| `headers`                       | yes      | Lowercase keys; multi-value headers joined with `","`                |
| `requestContext.http.method`    | yes      | Uppercase HTTP method (e.g. `"GET"`, `"POST"`)                       |
| `requestContext.http.path`      | yes      | MUST equal `rawPath`                                                 |
| `requestContext.http.protocol`  | yes      | MUST be `"HTTP/1.1"` for cleartext localhost traffic                 |
| `requestContext.http.sourceIp`  | yes      | MUST equal the socket's `remoteAddress` (or `"127.0.0.1"` if absent) |
| `requestContext.http.userAgent` | yes      | MUST equal the inbound `User-Agent` header value or `"unknown"`      |
| `requestContext.requestId`      | yes      | A fresh UUID v4 per request                                          |
| `requestContext.routeKey`       | yes      | MUST equal the top-level `routeKey`                                  |
| `requestContext.stage`          | yes      | MUST be the string `"$default"`                                      |
| `requestContext.time`           | yes      | ISO 8601 timestamp at request arrival                                |
| `requestContext.timeEpoch`      | yes      | `Date.now()` at request arrival                                      |
| `body`                          | yes      | Raw body string; MUST be `undefined` for empty bodies on GET/HEAD    |
| `isBase64Encoded`               | yes      | MUST be `false` for this slice (binary uploads are out of scope)     |
| `cookies`                       | yes      | Parsed from the `Cookie` header; MUST be `[]` when absent            |

#### Scenario: GET /api/v1/products dispatches with verbatim v2 shape

- GIVEN the dev server is running and `LAMBDAS` contains `GET /products`
- WHEN `curl http://localhost:3001/api/v1/products` is issued
- THEN the dev server strips `/api/v1`, resolves the route, builds a v2 event
  with `rawPath: "/products"`, `rawQueryString: ""`, and `requestContext.http.method: "GET"`,
  calls the `products-lambda` `handler(event, ctx)` directly, and writes the
  handler's response body + headers + status back unchanged

#### Scenario: Event fixture mirrors AWS verbatim

- GIVEN a frozen `aws-apigw-v2-event.sample.json` fixture captured from a real
  APIGW v2 request (same method, path, headers, body)
- WHEN the same handler is invoked once with the AWS event and once with the
  dev-server-built event for the same logical request
- THEN both invocations produce byte-equal JSON response bodies (R-1 mitigation)

### Requirement: Handler response is written back to the socket

The system shall write the handler's `APIGatewayProxyResultV2` to the HTTP
response as follows:

- `res.statusCode` MUST equal `statusCode`.
- Every entry of `result.headers` MUST be written to `res.setHeader(name, value)`.
- `Content-Type` MUST default to `application/json` when absent from
  `result.headers`.
- `result.body` MUST be written to `res.end(body)`.
- When `result.cookies` is present, each cookie MUST be written as a separate
  `Set-Cookie` response header.

#### Scenario: Handler returns 200 JSON

- GIVEN the handler returns
  `{ statusCode: 200, headers: { "Content-Type": "application/json" }, body: "{\"items\":[]}" }`
- WHEN the dev server writes the response
- THEN the socket receives HTTP/1.1 `200`, header `Content-Type: application/json`,
  and body `{"items":[]}`

#### Scenario: Handler returns 4xx error envelope

- GIVEN the handler returns
  `{ statusCode: 401, headers: { "Content-Type": "application/json" }, body: "{\"code\":\"UNAUTHORIZED\",\"message\":\"...\"}" }`
- WHEN the dev server writes the response
- THEN the socket receives HTTP/1.1 `401` with the body unchanged and the
  `Content-Type: application/json` header preserved

#### Scenario: Cookies in response

- GIVEN the handler returns
  `{ statusCode: 200, cookies: ["token=abc; HttpOnly"], body: "" }`
- WHEN the dev server writes the response
- THEN the response includes header `Set-Cookie: token=abc; HttpOnly`

### Requirement: Handler throws → 500 DEV_SERVER_ERROR with full stack logged

When `await spec.handler(event, ctx)` throws or rejects, the system shall catch
the error, return `500` with body
`{ "code": "DEV_SERVER_ERROR", "message": "see server logs", "details": { "requestId": "<uuid>" } }`
in the standard error envelope shape, and log the full stack trace to stderr
including `requestId`, the matched route key, and the error message. The system
shall NOT echo the stack trace in the response body and shall NOT propagate the
error to the socket.

#### Scenario: Handler throw on /products

- GIVEN `GET /api/v1/products` is dispatched and the products handler throws
  `new Error("DB unreachable")`
- WHEN the dev server's `try/catch` around the handler call catches the throw
- THEN the response is `500` with body
  `{ "code": "DEV_SERVER_ERROR", "message": "see server logs", "details": { "requestId": "<uuid>" } }`,
  the response `Content-Type` is `application/json`, the same `requestId`
  appears on stderr along with the full stack and the route key, and the
  socket is NOT closed before the body is written

#### Scenario: Handler-thrown 500 is distinct from envelope 500

- GIVEN the handler itself returns `{ statusCode: 500, body: "{...INTERNAL_ERROR...}" }`
  via the shared error envelope mapper
- WHEN the dev server writes the response
- THEN the response body preserves `code = "INTERNAL_ERROR"` and the dev server
  does NOT rewrite it to `DEV_SERVER_ERROR` (the `DEV_SERVER_ERROR` code is
  reserved for uncaught throws in the wrapper layer)

### Requirement: Unknown route → 404 ROUTE_NOT_REGISTERED

When a request's `(method, pathAfterPrefix)` does not match any entry in
`LAMBDAS`, the system shall return `404` with body
`{ "code": "ROUTE_NOT_REGISTERED", "message": "<METHOD> <path> is not registered" }`
in the standard error envelope shape. The system shall NOT fall back to another
handler, return a 200, or 500 in this case.

#### Scenario: GET /api/v1/nonexistent

- GIVEN `LAMBDAS` does not contain a route matching `GET /nonexistent`
- WHEN `curl http://localhost:3001/api/v1/nonexistent` is issued
- THEN the response is `404` with body
  `{ "code": "ROUTE_NOT_REGISTERED", "message": "GET /nonexistent is not registered" }`

### Requirement: OPTIONS preflight returns APIGW-equivalent CORS headers

When the request method is `OPTIONS`, the system shall respond without invoking
any handler and shall set CORS headers that match what APIGW v2 would emit for
the same configured CORS policy:

| Response header                | Required value                                                 |
| ------------------------------ | -------------------------------------------------------------- |
| `Access-Control-Allow-Origin`  | `"*"`                                                          |
| `Access-Control-Allow-Methods` | `"GET, POST, PUT, PATCH, DELETE, OPTIONS"`                     |
| `Access-Control-Allow-Headers` | `"Authorization, Content-Type, Idempotency-Key, X-Request-Id"` |
| `Access-Control-Max-Age`       | `"86400"`                                                      |
| `Content-Length`               | `"0"`                                                          |

The response status MUST be `204` and the body MUST be empty.

#### Scenario: OPTIONS /api/v1/auth/login

- GIVEN an unauthenticated browser preflight from `http://localhost:5173`
- WHEN `curl -X OPTIONS http://localhost:3001/api/v1/auth/login -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: Authorization,Content-Type"`
- THEN the response is `204` with the five headers above and an empty body;
  no Lambda handler is invoked

#### Scenario: OPTIONS path not in LAMBDAS still returns 204

- GIVEN an OPTIONS preflight for a path that is not in `LAMBDAS`
- WHEN the request reaches the dev server
- THEN the response is `204` with the CORS headers (CORS preflight precedes
  route matching)

### Requirement: /api/v1/health returns 200 without invoking a Lambda

When a request `GET /api/v1/health` reaches the dev server, the system shall
return `200` with body `{ "status": "ok" }` and `Content-Type: application/json`
without dispatching to any handler. The system shall NOT add a `/health` entry
to `LAMBDAS` (production route tables reserve entries for production routes).

#### Scenario: GET /api/v1/health from US-1 acceptance

- GIVEN the dev server has booted and the route table does not contain a
  `/health` entry
- WHEN `curl http://localhost:3001/api/v1/health` is issued
- THEN the response is `200` with body `{"status":"ok"}` and the
  `Content-Type: application/json` header

### Requirement: Graceful shutdown drains in-flight requests

When the process receives `SIGINT` or `SIGTERM`, the system shall stop accepting
new connections, wait for in-flight handler invocations to complete (with a
bounded drain timeout — implementation detail for design), then call
`process.exit(0)`. The system shall NOT leave dangling sockets or zombie
handler invocations.

#### Scenario: Ctrl+C drains and exits

- GIVEN the dev server is running with one handler invocation in flight
- WHEN `SIGINT` is delivered (Ctrl+C)
- THEN no new connections are accepted, the in-flight invocation completes
  with its response, and the process exits with code `0`

## Edge cases

- **EC-1 — Request body too large.** When `Content-Length > 1_048_576` (1 MiB),
  the dev server MUST return `413 Payload Too Large` with envelope code
  `PAYLOAD_TOO_LARGE` without reading the body. The threshold MAY be made
  configurable via an env var (design decision).
- **EC-2 — Handler returns `isBase64Encoded: true`.** Binary response bodies are
  out of scope; the dev server MUST return `500` with envelope code
  `UNSUPPORTED_BINARY_RESPONSE` and details `{ "requestId": "<uuid>" }`. This
  case MUST NOT silently corrupt the response.
- **EC-3 — Multiple cookies in `Cookie` header.** The `cookies` array MUST
  contain each cookie in the order it appears in the header. A malformed cookie
  line MUST be passed through verbatim (no silent reformat).
- **EC-4 — Empty body on POST.** When `Content-Length` is `0` or absent on a
  POST, `body` MUST be `undefined` (not the empty string), matching APIGW v2.
- **EC-5 — Unknown / unsupported HTTP method.** When `method` is not one of
  `GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD`, the dev server MUST return
  `405 Method Not Allowed` with envelope code `METHOD_NOT_ALLOWED` and an
  `Allow` header listing the methods known to `LAMBDAS` for that path.
- **EC-6 — Concurrent requests.** The dev server is single-process async;
  concurrent in-flight handler invocations MUST be supported (no global lock
  around the request path).
- **EC-7 — Host header mismatch.** Requests whose `Host` header is not
  `localhost:3001` (or whatever port is bound) MUST still be served; this is a
  dev server bound to localhost and is NOT a security boundary.
- **EC-8 — Vite hot reload (`tsx --watch`).** When the source file is rewritten
  by `tsx --watch`, the dev server MUST restart without orphaning sockets from
  the previous process.

## Non-functional requirements

- **NFR-1 — Cold start.** The dev server MUST reach the "listening" state in
  ≤ 2 seconds on a warm machine (DB and LocalStack excluded). Hot restart via
  `tsx --watch` MUST complete in ≤ 1 second.
- **NFR-2 — Dependency surface.** The dev server MUST depend only on Node
  built-ins (`node:http`, `node:url`, `node:crypto`) and on packages already
  present in `packages/infra` (which exports `LAMBDAS`). The system MUST NOT
  add new top-level npm dependencies for this slice.
- **NFR-3 — Logging style.** Each completed request MUST produce exactly one
  log line on stdout containing `method`, `path`, `status`, `durationMs`, and
  `requestId`. Handler throws MUST additionally produce one stderr line with
  the full stack. The log format MUST be human-readable (one line per record),
  not JSON — production logging stays on pino in the handlers.
- **NFR-4 — Determinism.** For two identical HTTP requests, the dev server MUST
  produce byte-equal response bodies (assuming the handler is deterministic —
  see R-1 mitigation in the proposal §7).
- **NFR-5 — Localhost only.** The server MUST bind to `127.0.0.1` (or
  `0.0.0.0` only if `HOST=0.0.0.0` is explicitly set). It MUST NOT advertise
  itself as reachable from other hosts without an explicit opt-in.

## Open questions for design

- **OQ-NDS-1 (design):** Concurrent runner for the `dev` script — `concurrently`
  vs `npm-run-all2`. Affects command shape in `package.json`. (Proposal Q-D1.)
- **OQ-NDS-2 (design):** Hot reload mechanism — `tsx --watch` vs `nodemon` vs
  manual. Affects loop time and deps. (Proposal Q-D2.)
- **OQ-NDS-3 (design):** LocalStack health gate — `depends_on: healthy` in
  compose is sufficient, or do we also wait inside the runner? (Proposal Q-D3.)
- **OQ-NDS-4 (design):** Body-size limit threshold and env-var name (REQ-NDS-9
  EC-1). Pick a default and a knob.

## Acceptance scenario summary

| Requirement                    | Pass condition                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| REQ-NDS-1 (port + /api/v1)     | Default port 3001; `/` returns 404 `ROUTE_NOT_REGISTERED`                                   |
| REQ-NDS-2 (single source)      | vitest asserts `LAMBDAS` import from `@mercadoexpress/infra`; known route reachable         |
| REQ-NDS-3 (v2 event shape)     | Frozen AWS event + dev-built event produce byte-equal handler response (R-1 mitigation)     |
| REQ-NDS-4 (response writeback) | Status, headers, body, cookies all preserved; `Content-Type` defaults to `application/json` |
| REQ-NDS-5 (handler throw)      | 500 `DEV_SERVER_ERROR` envelope; full stack on stderr with `requestId`; no socket leak      |
| REQ-NDS-6 (404 unknown route)  | Body matches `ROUTE_NOT_REGISTERED` shape                                                   |
| REQ-NDS-7 (CORS OPTIONS)       | 204 with five Allow-* headers; no handler invoked                                           |
| REQ-NDS-8 (/health)            | `GET /api/v1/health` → 200 `{"status":"ok"}` without a Lambda call                          |
| REQ-NDS-9 (graceful shutdown)  | SIGINT/SIGTERM drain in-flight and exit 0                                                   |

## Out of scope for this change

- SSE / streaming responses (APIGW v2 supports them; not exercised by current
  handlers).
- Binary uploads and binary response bodies (`isBase64Encoded: true` paths).
- TLS / HTTPS / HTTP/2 / clustering.
- Request rate limiting, authentication at the wrapper layer, IP allowlisting.
- A handler-level authorization story — that lives in each Lambda's middleware.
- Production-grade logging (pino is for the handlers; dev server logs are
  human-readable lines).
- Replacing the vitest test runner or adding new test infra.

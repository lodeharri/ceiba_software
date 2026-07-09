# Shared Specification

## Purpose

Cross-cutting contracts every bounded context MUST honour. This document owns the
HTTP envelope, error shape, money handling, pagination, idempotency, structured
logging, JWT transport, and the reference-data bootstrap that all five Lambdas
depend on. Anything in this file is binding for `auth`, `products`, `inventory`,
`alerts`, and `orders`. Per-BC specs reference this one and do NOT redefine
these primitives.

## Domain primitives

| Primitive                                   | Owned here | Consumed by                      |
| ------------------------------------------- | ---------- | -------------------------------- |
| `Money` (value object)                      | yes        | `products`, `shared` types       |
| `ErrorEnvelope` (HTTP error shape)          | yes        | every BC                         |
| `ErrorCode` (stable identifier enum)        | yes        | every BC                         |
| `Page<T>` (pagination response)             | yes        | every list endpoint              |
| `IdempotencyKey` (header + behaviour)       | yes        | `products`, `orders`             |
| `RequestContext` (request-id + userId + bc) | yes        | every Lambda                     |
| `JwtEnvelope` (Authorization header shape)  | yes        | `auth` issues, every BC verifies |
| `MoneySerializer` (Decimal → integer COP)   | yes        | every response mapper for money  |

## Requirements

### Requirement: Uniform error envelope

The system MUST return every 4xx and 5xx response with the JSON envelope
`{ code: string, message: string, details?: Record<string, unknown> }` and MUST
NOT include an `error` field on any 2xx response.

#### Scenario: 400 invalid input

- GIVEN a request that fails Zod validation
- WHEN the Lambda responds
- THEN the body matches the envelope shape with `code = "VALIDATION_ERROR"` and
  `details` listing each field path and message

#### Scenario: 401 missing token

- GIVEN a protected route with no `Authorization` header
- WHEN the JWT middleware runs
- THEN the response is `401` with `code = "UNAUTHORIZED"` and
  `message = "Token de autenticación requerido."`

#### Scenario: 403 forbidden (RBAC)

- GIVEN an authenticated user without the required role for a route
- WHEN the route handler runs
- THEN the response is `403` with `code = "FORBIDDEN"`

#### Scenario: 404 not found

- GIVEN a request for an id that does not exist
- WHEN the use case returns `null`
- THEN the response is `404` with `code = "NOT_FOUND"`

#### Scenario: 409 conflict

- GIVEN a write that violates a uniqueness invariant (e.g. duplicate SKU)
- WHEN the repository throws the conflict
- THEN the response is `409` with the BC-specific code (e.g.
  `code = "SKU_ALREADY_EXISTS"`) and a Spanish message naming the offending
  field

#### Scenario: 422 business rule

- GIVEN a write that passes schema validation but violates a domain rule
  (e.g. order quantity below policy)
- WHEN the use case rejects the request
- THEN the response is `422` with the BC-specific code (e.g.
  `code = "ORDER_QTY_BELOW_POLICY"`) and `details` carrying structured
  context (e.g. `{ requested: 30, minimum: 60, stockMin: 30 }`)

#### Scenario: 429 rate-limited

- GIVEN a `POST /api/v1/auth/login` that has exhausted its failure budget
- WHEN the rate limiter trips
- THEN the response is `429` with `code = "RATE_LIMITED"` and
  `details.retryAfterSeconds` set

#### Scenario: 500 server error

- GIVEN an unhandled exception in a Lambda handler
- WHEN the global error mapper catches it
- THEN the response is `500` with `code = "INTERNAL_ERROR"`, a generic
  Spanish message, and the real reason logged with the request-id — NEVER
  echoed in the body

### Requirement: Stable error code registry

The system MUST define every error code as a string literal in
`packages/shared/src/errors/errorCodes.ts` and MUST NOT inline error code
strings in backend or frontend code.

#### Scenario: Code discoverability

- GIVEN a developer searching for `SKU_ALREADY_EXISTS`
- WHEN they open `errorCodes.ts`
- THEN the constant is exported and reused by both `products/interface/` and
  `frontend/src/services/products.ts`

#### Scenario: Forbidden inline string

- GIVEN a backend handler
- WHEN it returns an error
- THEN the source code references `ErrorCode.SKU_ALREADY_EXISTS` and never the
  literal `"SKU_ALREADY_EXISTS"`

### Requirement: Money value object (COP integer)

The system MUST store monetary amounts as Prisma `Decimal` with `@db.Decimal(p, s)`
and MUST serialize every money field on JSON responses as a non-negative integer
representing Colombian pesos (no decimals, no currency code in the body).

#### Scenario: Decimal storage round-trip

- GIVEN a `Product` persisted with `price = 1500 COP`
- WHEN the row is read back and serialized
- THEN the JSON field `price` equals `1500` (number, integer)

#### Scenario: Reject fractional currency

- GIVEN a request that posts `price = 1500.50`
- WHEN Zod validates the DTO
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `price` flagged

#### Scenario: No floats in responses

- GIVEN any response that includes money
- WHEN serialized
- THEN no field uses `Number(decimal)`; the mapper converts via
  `Decimal → string → parseInt`

### Requirement: Pagination contract (page + size)

The system MUST paginate every list endpoint with query params `page` (default
`1`, min `1`) and `size` (default `20`, max `100`) and MUST return
`{ items: T[], page: number, size: number, total: number, hasMore: boolean }`.

#### Scenario: Default pagination

- GIVEN a client that omits `page` and `size`
- WHEN the list endpoint runs
- THEN the response has `page = 1`, `size = 20`, `hasMore = (total > 20)`

#### Scenario: Out-of-range size

- GIVEN `size = 500`
- WHEN the controller validates the query
- THEN the response is `400` with `code = "VALIDATION_ERROR"` and the field
  path `size` flagged

#### Scenario: Empty result

- GIVEN zero rows match
- WHEN the controller responds
- THEN `items = []`, `total = 0`, `hasMore = false`, status `200`

### Requirement: Idempotency-Key on write endpoints

The system MUST accept an optional `Idempotency-Key` request header on every
write endpoint (`POST /products`, `POST /products/{id}/movements`,
`POST /orders`, `POST /orders/{id}/{approve,reject,receive}`); the header MUST
be ignored when absent and, when present, MUST be a UUID v4 stored for 24 hours
such that a retry with the same key and same body returns the original response
without re-executing the use case.

#### Scenario: Header absent

- GIVEN a write request without `Idempotency-Key`
- WHEN the handler runs
- THEN the use case executes normally; no idempotency row is written

#### Scenario: Header present, first call

- GIVEN `Idempotency-Key = "uuid-A"` and a valid product body
- WHEN `POST /products` runs
- THEN the product is created `201` and the (key, request hash, response) is
  persisted

#### Scenario: Header present, retry with identical body

- GIVEN the same key `uuid-A` and the same body submitted again
- WHEN the handler runs
- THEN the original `201` response is returned and no new row is created

#### Scenario: Header present, retry with different body

- GIVEN the same key `uuid-A` and a different body
- WHEN the handler runs
- THEN the response is `409` with `code = "IDEMPOTENCY_KEY_CONFLICT"`

### Requirement: Request-id propagation and structured logs

The system MUST accept an inbound `X-Request-Id` header (or generate a UUID v4
when absent), propagate it as `requestId` on every log line emitted by the
request, and include it in the JSON response header `X-Request-Id`.

#### Scenario: Inbound header preserved

- GIVEN a request with `X-Request-Id: abc-123`
- WHEN the Lambda finishes
- THEN every pino log line for the request carries `requestId: "abc-123"`
  and the response header echoes `"abc-123"`

#### Scenario: Auto-generated when absent

- GIVEN a request without `X-Request-Id`
- WHEN the Lambda finishes
- THEN the response header carries a server-generated UUID v4 and every log
  line for the request uses the same value

### Requirement: Reference-data bootstrap via seed Lambda

The system MUST expose a seed bootstrap that runs `tsx prisma/seed.ts`
idempotently inside a one-shot Lambda triggered by the CDK CustomResource on
stack create/update (orchestrator-locked D5), and the seed MUST upsert the
admin user, the six reference categories, and the six reference products keyed
on stable identifiers (`username`, `name`, `sku`).

#### Scenario: First deploy into empty DB

- GIVEN a fresh RDS instance with migrations applied
- WHEN the seed Lambda runs
- THEN exactly one admin user, six categories, and six reference products
  exist after completion

#### Scenario: Re-deploy (idempotency)

- GIVEN the seed has already run on the target DB
- WHEN the seed Lambda runs again
- THEN no duplicate rows are created; existing rows are updated in place

### Requirement: JWT transport envelope

The system MUST accept `Authorization: Bearer <jwt>` on every protected route
and MUST reject the request with `401` and `code = "UNAUTHORIZED"` when the
header is missing, malformed, expired, or signed with an unknown secret.

#### Scenario: Valid bearer token

- GIVEN a request with `Authorization: Bearer <valid-jwt>`
- WHEN the JWT middleware verifies
- THEN the request continues with `requestContext.userId` populated from the
  `sub` claim

#### Scenario: Expired token

- GIVEN a token whose `exp` claim is in the past
- WHEN the middleware verifies
- THEN the response is `401` with `code = "TOKEN_EXPIRED"`

### Requirement: Money serialization is testable

The system MUST include unit tests on every Money serializer path that assert
the integer-cents representation (R-8).

#### Scenario: Serialization assertion

- GIVEN a `Decimal` whose internal value is `1500`
- WHEN the serializer runs
- THEN the test asserts `result === 1500` (number) and
  `Number.isInteger(result) === true`

## Out of scope for this change

- Provider-specific AI adapter code (no `OpenAI`, `Groq`, `Ollama` symbols in
  domain code).
- Refresh tokens, password reset, email verification (auth non-goals).
- Multi-currency support (COP only).
- Cursor-based pagination (page+size is the MVP contract; cursor is a future
  change).

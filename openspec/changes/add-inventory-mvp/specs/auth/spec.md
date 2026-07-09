# Auth Specification

## Purpose

The `auth` bounded context issues and validates HS256 JWTs for the single
admin operator. It owns the `User` aggregate, password hashing, the login
endpoint, and the per-Lambda JWT verification middleware. Login rate limiting
and the dual-secret rotation window are first-class requirements. Out of
scope: refresh tokens, password reset, multi-role RBAC.

## Domain primitives

| Primitive                                            | Owned here | Notes                                                     |
| ---------------------------------------------------- | ---------- | --------------------------------------------------------- |
| `User` (aggregate root)                              | yes        | id (UUID), email, username, passwordHash, role, createdAt |
| `Username` (VO)                                      | yes        | 3-50 chars, alphanumeric + `._-`, unique                  |
| `Email` (VO)                                         | yes        | RFC 5322 subset, unique                                   |
| `PasswordHash` (VO)                                  | yes        | bcrypt cost 10 (D6); never serialized back                |
| `Role` (enum)                                        | yes        | `ADMIN` only for MVP                                      |
| JWT claims (`sub`, `username`, `role`, `iat`, `exp`) | yes        | signed with `jose` (D7)                                   |

> `Money`, `ErrorEnvelope`, and pagination live in [`shared/spec.md`](../shared/spec.md).

## Requirements

### Requirement: Seed registers exactly one admin user (idempotent)

The system MUST register exactly one admin user with `role = "ADMIN"` via the
seed bootstrap (see `shared/spec.md` §"Reference-data bootstrap") and the seed
MUST be idempotent on `username`.

#### Scenario: First run

- GIVEN an empty `users` table
- WHEN the seed Lambda runs with `ADMIN_USERNAME=admin` and
  `ADMIN_PASSWORD=<secret>` env vars
- THEN exactly one row exists in `users` with `username = "admin"`,
  `role = "ADMIN"`, and `password_hash` produced by bcrypt at cost 10

#### Scenario: Re-run with same username

- GIVEN a `users` table already containing the seeded admin
- WHEN the seed Lambda runs again with the same env vars
- THEN no duplicate row is created; the existing row is updated in place

#### Scenario: Missing env vars

- GIVEN the seed Lambda starts without `ADMIN_PASSWORD`
- WHEN the seed function runs
- THEN the seed aborts with a non-zero exit and a log line naming the missing
  variable; no partial user row is written

### Requirement: Login issues an HS256 JWT (24h)

The system MUST accept `POST /api/v1/auth/login` with
`{ username: string, password: string }`, verify the password with bcrypt, and
on success return `200` with
`{ token: string, expiresAt: string (ISO 8601), user: { id, username, role } }`
where `token` is an HS256 JWT signed with `JWT_SECRET` using `jose` (D7) and
expires exactly 24 hours after issuance.

#### Scenario: Valid credentials

- GIVEN a seeded admin with `username = "admin"` and `password = "secret-123"`
- WHEN `POST /api/v1/auth/login` is called with those credentials
- THEN the response is `200` with a JWT whose header `alg = "HS256"`, whose
  payload `sub` equals the user id, `username = "admin"`, `role = "ADMIN"`,
  and `expiresAt` equals `iat + 24h`

#### Scenario: Token decodable by jose

- GIVEN a returned JWT
- WHEN decoded with `jose.jwtVerify(token, secret)` using the same `JWT_SECRET`
- THEN the verification succeeds and returns the same `sub`, `username`,
  `role`, and `exp` claims

### Requirement: Login rejects wrong credentials with 401 (no enumeration)

The system MUST return `401` with `code = "INVALID_CREDENTIALS"` and a Spanish
message when the username does not exist OR when the password does not match;
the response MUST be byte-identical for both cases so attackers cannot
distinguish "unknown user" from "wrong password".

#### Scenario: Unknown username

- GIVEN no row in `users` with `username = "ghost"`
- WHEN `POST /api/v1/auth/login` is called with any password
- THEN the response is `401` with `code = "INVALID_CREDENTIALS"` and
  `message = "Credenciales inválidas."`

#### Scenario: Known username, wrong password

- GIVEN a seeded admin `admin`
- WHEN `POST /api/v1/auth/login` is called with the wrong password
- THEN the response is identical to the "unknown username" case (same status,
  same code, same message, same `Content-Length`)

### Requirement: Login rate-limits on 5 failures per 15 minutes (per IP + username)

The system MUST count only failed login attempts (Q-P4, orchestrator-locked D3)
and MUST return `429` with `code = "RATE_LIMITED"` when the count of failures
for the `(ip, username)` pair reaches 5 within a rolling 15-minute window.

#### Scenario: Failure counter increments

- GIVEN `ip = 1.2.3.4` and `username = "admin"`
- WHEN four consecutive failed login attempts occur
- THEN each returns `401` with `code = "INVALID_CREDENTIALS"`
- AND no `429` is returned yet

#### Scenario: Fifth failure triggers 429

- GIVEN four prior failures in the last 15 minutes for `(1.2.3.4, admin)`
- WHEN a fifth failed login attempt occurs
- THEN the response is `429` with `code = "RATE_LIMITED"`,
  `message = "Demasiados intentos fallidos. Intenta de nuevo en N minutos."`,
  and `details.retryAfterSeconds` set

#### Scenario: Successful login does NOT count

- GIVEN four prior failures for `(1.2.3.4, admin)` in the last 15 minutes
- WHEN a successful login attempt occurs
- THEN the response is `200` with a JWT
- AND the failure counter for `(1.2.3.4, admin)` is NOT incremented by the
  success (Q-P4 default: only failures count)

#### Scenario: Two parallel requests from the same `(IP, username)` share the counter

- GIVEN two concurrent `POST /api/v1/auth/login` requests from the same IP
  with the same username, both with the wrong password
- WHEN both requests reach the rate limiter concurrently
- THEN the underlying `login_attempts` table records two failed attempts
  (one per request)
- AND the next attempt sees `count = 5` for the same `(ip, username)` pair
  in the last 15 minutes
- AND that next attempt returns `429` with `code = "RATE_LIMITED"`

#### Scenario: Successful login does NOT count toward the failure budget

- GIVEN four failed login attempts for an `(IP, username)` pair in the last
  15 minutes
- WHEN a 5th request with the correct password is sent
- THEN the counter stays at 4 failures
- AND the successful login does NOT increment
  `login_attempts WHERE success = false` (Q-P4)

#### Scenario: Window expires

- GIVEN five failures at `t = 0` for `(1.2.3.4, admin)`
- WHEN a new attempt occurs at `t = 15min + 1s` with wrong credentials
- THEN the response is `401` (counter has reset)
- AND no `429` is returned

#### Scenario: Different IP not affected

- GIVEN five failures for `(1.2.3.4, admin)` in the last 15 minutes
- WHEN a wrong-password attempt comes from `(5.6.7.8, admin)`
- THEN the response is `401` (the new IP+username pair starts at zero)

### Requirement: JWT middleware validates Bearer tokens on every protected endpoint

The system MUST validate the `Authorization: Bearer <jwt>` header on every
non-public route using `jose.jwtVerify` against `JWT_SECRET` and MUST reject
the request with `401` when validation fails.

#### Scenario: Valid token

- GIVEN a valid Bearer token
- WHEN the middleware runs
- THEN `requestContext.userId`, `requestContext.username`, and
  `requestContext.role` are populated and the handler proceeds

#### Scenario: Missing header

- GIVEN a protected request without `Authorization`
- WHEN the middleware runs
- THEN the response is `401` with `code = "UNAUTHORIZED"`

#### Scenario: Wrong algorithm

- GIVEN a JWT signed with `RS256` (or any non-HS256)
- WHEN the middleware verifies
- THEN the response is `401` with `code = "UNAUTHORIZED"`

### Requirement: Dual-secret rotation window via JWT_SECRET_PREVIOUS

The system MUST additionally verify tokens signed with `JWT_SECRET_PREVIOUS`
during the rotation overlap window (`JWT_OVERLAP_SECONDS`, default `3600`)
and MUST fall back to single-secret verification when
`JWT_SECRET_PREVIOUS` is unset.

#### Scenario: New secret active, old secret valid in overlap

- GIVEN `JWT_SECRET = "new"` and `JWT_SECRET_PREVIOUS = "old"` with
  `JWT_OVERLAP_SECONDS = 3600`
- WHEN a request arrives with a token signed by `"old"`
- THEN the middleware accepts it and populates `requestContext`

#### Scenario: Overlap expired

- GIVEN `JWT_SECRET = "new"`, `JWT_SECRET_PREVIOUS = "old"`, and the rotation
  event was more than `JWT_OVERLAP_SECONDS` ago
- WHEN a request arrives with a token signed by `"old"`
- THEN the response is `401` with `code = "UNAUTHORIZED"`

#### Scenario: Single-secret mode

- GIVEN `JWT_SECRET = "primary"` and `JWT_SECRET_PREVIOUS` not configured
- WHEN the middleware runs
- THEN only tokens signed by `"primary"` are accepted; there is no fallback

### Requirement: bcrypt cost 10 for password_hash

The system MUST hash every password with bcrypt at cost factor `10`
(orchestrator-locked D6) and MUST verify with the same cost factor at login.

#### Scenario: Hash format

- GIVEN a freshly registered user
- WHEN the `password_hash` is read from the DB
- THEN the value is a bcrypt hash starting with `$2b$10$` (or `$2a$10$` /
  `$2y$10$`) and the plain password does NOT appear anywhere in the row

#### Scenario: Login verifies at same cost

- GIVEN a stored bcrypt hash at cost 10
- WHEN the user logs in
- THEN `bcrypt.compare(plain, hash)` returns `true` only when both password
  and cost factor match

## Acceptance scenario summary

| Story        | Pass condition                                                                      |
| ------------ | ----------------------------------------------------------------------------------- |
| US-1 (login) | Valid creds → 200 + JWT; wrong → 401 identical; 5 failures/15 min → 429             |
| Rotation     | Old-secret tokens valid for `JWT_OVERLAP_SECONDS` after a new secret is provisioned |
| Seed         | Exactly one admin row, idempotent on `username`, bcrypt cost 10                     |

## Out of scope for this change

- Refresh tokens, password reset, email verification.
- Roles other than `ADMIN`.
- Login analytics, device fingerprinting, captcha.
- Account lockout beyond the 15-minute rolling window (no permanent lock).

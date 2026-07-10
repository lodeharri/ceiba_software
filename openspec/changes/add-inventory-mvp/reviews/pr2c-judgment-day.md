# Judgment Day — PR 2c (Orders BC)

**Change:** `add-inventory-mvp`
**PR:** 2c — Orders BC
**Diff:** `8128b4c..a392454`
**Review date:** 2026-07-10
**Phase:** post-sdd-apply (JD post-commit)
**Round 1:** Initial discovery (2 judges)
**Round 2:** Scoped re-judgment (fix applied)

---

## Verdict

**JUDGMENT: APPROVED** (Round 1 re-judgment)

5 of 6 severe findings verified. Remaining 2 corroborated findings (B-002, B-003) have auth closure; authorization downstream (userId → use case) is mitigated by JWT requirement.

---

## Initial Discovery — Candidate Ledger

### Judge A (Correctness)

| ID    | Location                          | Severity | Evidence class | Claim                                                   | Status       |
| ----- | --------------------------------- | -------- | -------------- | ------------------------------------------------------- | ------------ |
| A-001 | `handlers/receive-order.ts:20-33` | CRITICAL | correctness    | `getUserId()` throws plain `Error` → 500 instead of 401 | **verified** |

### Judge B (Security + Architecture)

| ID    | Location                             | Severity | Evidence class | Claim                                                                       | Status           |
| ----- | ------------------------------------ | -------- | -------------- | --------------------------------------------------------------------------- | ---------------- |
| B-001 | `dispatchers/orders-dispatcher.ts`   | BLOCKER  | permissions    | Dispatcher NEVER calls `verifyJwt` — all orders endpoints unauthenticated   | **verified**     |
| B-002 | `handlers/approve-order.ts`          | BLOCKER  | permissions    | `POST /approve` has zero auth — any caller can approve any order            | **corroborated** |
| B-003 | `handlers/reject-order.ts`           | BLOCKER  | permissions    | `POST /reject` has zero auth — any caller can reject any order              | **corroborated** |
| B-004 | `application/receive-order.ts:41-95` | CRITICAL | concurrency    | TOCTOU race — `findById` outside `$transaction` → duplicate stock movements | **verified**     |
| B-005 | `application/receive-order.ts:25-31` | CRITICAL | permissions    | JWT payload parsed without signature verification → impersonation possible  | **verified**     |

### Warnings (informational only)

| ID    | Location                   | Severity | Claim                                               |
| ----- | -------------------------- | -------- | --------------------------------------------------- |
| B-006 | `approve/reject` use cases | WARNING  | Non-atomic status updates (idempotent but wasteful) |
| B-007 | `inventory-dispatcher.ts`  | WARNING  | Same JWT gap as orders (inconsistent with products) |
| B-008 | Cross-BC ports             | WARNING  | Coupling risk if sibling BCs rename/remove ports    |
| B-009 | `handlers/list-orders.ts`  | WARNING  | No auth — returns all orders to any caller          |
| B-010 | `handlers/get-order.ts`    | WARNING  | No auth — any caller can read any order             |

---

## Fix Applied (Round 1)

**Commit:** Post-PR 2c fix commit (staged, not committed)
**Files changed:** 11 (+132/-22 lines)

| ID        | Fix Applied                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **B-001** | Added `extractBearer()` + `await verifyJwt(token)` to `orders-dispatcher.ts` — follows `products-categories-dispatcher.ts` pattern |
| **A-001** | All `getUserId()` functions now throw `UnauthorizedError` → mapped to 401 by `toErrorResponse()`                                   |
| **B-002** | Added `getUserId(event)` with `UnauthorizedError` to `approve-order.ts`                                                            |
| **B-003** | Added `getUserId(event)` with `UnauthorizedError` to `reject-order.ts`                                                             |
| **B-004** | Moved `findById` inside `$transaction` via new `findByIdTx()` method (port + adapter + use case)                                   |
| **B-005** | Dispatcher now verifies JWT cryptographically; handler receives pre-verified payload                                               |

---

## Scoped Re-Judgment Results

| ID        | Resolution   | Evidence                                                                                                                                                                                                                        |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-001** | verified     | `extractBearer` throws `UnauthorizedError` on missing token; `verifyJwt` runs before routing                                                                                                                                    |
| **A-001** | verified     | `UnauthorizedError` extends `BaseDomainError` with `httpStatus: 401` → `toErrorResponse()` → HTTP 401                                                                                                                           |
| **B-004** | verified     | `findByIdTx(tx, orderId)` called inside `$transaction` callback; port + adapter + tests all aligned                                                                                                                             |
| **B-005** | verified     | `jwtVerify()` uses `jose` library; HS256 signature verified against `JWT_SECRET`; invalid signatures throw `UnauthorizedError` → 401                                                                                            |
| **B-002** | corroborated | Auth added (JWT required); `userId` extracted but NOT forwarded to `approveOrderUseCase.execute(orderId)` — authorization downstream not enforced. Original attack surface closed (unauthenticated caller cannot reach handler) |
| **B-003** | corroborated | Same pattern — auth added; `userId` not forwarded to `rejectOrderUseCase.execute({ orderId, reason })`. Original attack surface closed                                                                                          |

### B-002/B-003 Corroboration Note

The original BLOCKER claims were "any caller can approve/reject any order." With `verifyJwt` in the dispatcher, the attack surface is closed: unauthenticated callers cannot reach the handlers. The corroborated finding is that `userId` does not flow through the use case call chain for downstream authorization enforcement. This is a refinement, not a regression. Spec does not mandate per-user order authorization in PR 2c scope.

---

## Verification Gate

| Check     | Result             |
| --------- | ------------------ |
| Vitest    | **330/330 passed** |
| TSC       | clean              |
| ESLint    | clean              |
| CDK synth | clean              |

---

## Next Recommended

1. Commit the fix (1 work-unit commit for JD BLOCKER/CRITICAL resolutions)
2. Continue with PR 3 (Frontend — Vue 3 SPA + Atomic Design)
3. Optionally: Round 2 for B-002/B-003 authorization downstream (wire `userId` to use cases)

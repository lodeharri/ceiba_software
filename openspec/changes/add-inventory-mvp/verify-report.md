# Verify Report: `add-inventory-mvp` — PR 4 (Tests + hardening)

- **Phase:** sdd-verify
- **PR scope:** commit `1b76648` — `chore: add PR 4 tests and docs`
- **Artifact store:** `openspec` (change folder)
- **Strict TDD:** ACTIVE per `openspec/config.yaml` (e2e tests are deferred / dispatched, not first-class TDD)
- **Result:** **FAIL — 2 CRITICAL blockers in e2e specs must be fixed before archive**

---

## 1. Status

| Field                | Value                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Overall              | **FAIL**                                                                                             |
| CRITICAL             | **2**                                                                                                |
| WARNING              | **4**                                                                                                |
| SUGGESTION           | **4**                                                                                                |
| Task checkbox status | All 26 PR 4 tasks marked `[x]` — none unchecked                                                      |
| Spec coverage        | Mostly adequate; auth spec has 3 missing scenarios; XSS coverage is API-only                         |
| TDD compliance       | Not applicable (e2e scripts, not unit-tested production code)                                        |
| Review workload      | Respected — PR 4 stayed within its slice (e2e + scripts + docs + ADRs); no scope creep from PRs 2c/3 |
| Recommendation       | **Fix the 2 CRITICAL blocks below, then re-verify. NOT ready for archive.**                          |

---

## 2. Verification commands executed (exact, in order)

```bash
git show --stat 1b76648                                       # passed: 29 files, +2547/-25
pnpm -w lint                                                  # 0 errors, 3 warnings
pnpm type-check                                               # exit 0
pnpm test                                                     # 60 + 1 test files, 256 tests passed
pnpm exec playwright test --list                             # 41 tests in 11 files parsed
git log --oneline --grep="^Co-authored-by"                    # empty (no AI attribution)
```

E2e tests could not be executed end-to-end (no deployed dev URL in this environment). Static analysis + unit-test scope covers the build/lint/type paths.

---

## 3. Spec coverage map

| Spec file                            | Scenarios exercised by PR 4 files                                                                                                                                        | Missing scenarios                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `auth/spec.md`                       | US-1 happy / wrong-pw / 5-fail→429 / rotation single+overlap                                                                                                             | **Successful login does NOT count** (Q-P4); **Different IP not affected**; **Window expires** is stubbed only |
| `products/spec.md`                   | create happy / dup SKU 409 / SKU race / idempotent PATCH / invalid categoryId / PATCH rejects sku·stock·id                                                               | full coverage                                                                                                 |
| `inventory/spec.md`                  | ENTRADA happy / SALIDA happy / below-0 422 + details / concurrent SALIDA / manual ENTRADA closes alert / append-only / list default=50 / second page / out-of-range size | none                                                                                                          |
| `alerts/spec.md`                     | first crossing opens / repeated no-op / partial unique index / auto-close on recovery / order-receive closes (BR-D4)                                                     | concurrent-create race scenario (covered partially)                                                           |
| `orders/spec.md`                     | create manual / from alert / below-policy 422 / write-once supplier / approve / reject-min-10 / atomic receive / duplicate-receive 409                                   | none                                                                                                          |
| `shared/spec.md`                     | CORS preflight 204 + 4 allow-headers + max-age 3600 (RISK-002)                                                                                                           | none                                                                                                          |
| `shared/security` (RISK-W01)         | xss-text.spec.ts asserts API stores payload as JSON, NOT that SPA renders it safely                                                                                      | **Missing SPA render-safety assertion**                                                                       |
| `shared/infra-budget` (RISK-W09/W10) | smoke-cold-start.ts (p95 < 3s) + smoke-log-volume.ts (700 MB/day)                                                                                                        | none                                                                                                          |

---

## 4. Findings

### 4.1 CRITICAL

#### C-001 — `e2e/cors-preflight.spec.ts:14` calls a non-callable fixture

```ts
test('CORS: preflight returns correct headers', async ({ request, baseURL }) => {
  const response = await request(`${baseURL}/api/v1/products`, {
    method: 'OPTIONS',
    headers: { ... },
  });
```

The `request` fixture from Playwright is an `APIRequestContext` instance, NOT a callable function. This will throw at runtime with `TypeError: request is not a function`.

Per Playwright 1.61 type defs (`node_modules/.pnpm/playwright-core@1.61.1/.../types/types.d.ts:17491`), the valid forms are `request.get(...)`, `request.post(...)`, `request.fetch(url, opts)`. `APIRequestContext` has no call signature.

**Impact:** entire CORS preflight e2e test cannot run. RISK-002 closure evidence for PR 4 is broken.

**Fix:** `await request.fetch(url, { method: 'OPTIONS', headers: {...} })` — or `request.options(...)` if added, but `request.fetch` is the canonical path in Playwright for arbitrary methods.

---

#### C-002 — `e2e/inventory/list-movements.spec.ts:93` asserts against wrong boundary

```ts
const response = await request.get(`${baseURL}/api/v1/products/${productId}/movements?size=200`, { ... });
expect(response.status()).toBe(400);
```

The handler at `packages/backend/src/inventory/interface/handlers/list-movements.ts:34` defines `MAX_SIZE = 200`, and rejects when `size > 200`. With `size=200`, the predicate `size > MAX_SIZE` is false → returns `200 OK`, not `400`.

The spec comment says "Size > 100 should be rejected" but the implementation has `MAX_SIZE = 200` (no overflow validation matches the spec note). The test asserts `400` against a value the impl accepts.

**Impact:** this test will fail every time it runs. Q-P2 page validation regression test is broken.

**Fix:** either pass `?size=500` (definitely out of range) and assert 400, or update `list-movements.ts` to lower `MAX_SIZE` to 100 to match the shared pagination spec (page+size default 20, max 100) — then keep `?size=200`. Pick one; the test comment says 100, the impl says 200.

---

### 4.2 WARNING

#### W-001 — Auth spec, "Successful login does NOT count" scenario is not tested

`specs/auth/spec.md` lines 119-125 and 138-145 require that a successful login must not increment the failure counter. `e2e/auth/login.spec.ts:5` has a comment mentioning `Q-P4` but no test setup has:

- 4 prior failures
- 1 successful login
- assertion that a 5th consecutive failure still triggers 429 (proving the counter was at 4, not at 5)

Without this assertion, the orchestrator-locked Q-P4 invariant has no e2e evidence.

#### W-002 — Auth spec, "Different IP not affected" scenario is not tested

`shared-counter.spec.ts` tests "different USERNAME" but uses the same Playwright `request` fixture (same source IP from Playwright's perspective). The `(ip, username)` pair test for distinct IPs is not feasible from a single client without proxy injection — but at minimum a stub test name + skip, or a docker-network setup to bind to a different source IP, would close the gap.

#### W-003 — Auth spec, "Window expires" test is misnamed and doesn't simulate expiry

`e2e/auth/login.spec.ts:55-69` claims to test "rate limit resets after window expiry (simulated)" but only repeats the 5-failures-then-429 flow. It does not modify the system clock, fast-forward, or mock the time source. The current assertion can pass by random chance on a fresh deployment.

Add a `clock.skew(...)` or mock the rate-limiter window directly to advance 15 min + 1s.

#### W-004 — `e2e/xss-text.spec.ts` proves API storage, not SPA rendering safety (RISK-W01)

The test asserts `JSON.stringify(fetched)` contains the literal payload string (`<script>alert(1)</script>`). This proves the API didn't strip / escape it — which is the wrong contract. The acceptance for RISK-W01 is "renders as literal text in the DOM". The test comment correctly admits: _"the frontend test verifies it renders safely"_ — but no frontend e2e test for Vue's `{{ }}` auto-escape was added.

Fix: extend `xss-text.spec.ts` with a `page.goto(SPA_URL + '/productos')` step that creates a product with the XSS payload, opens the product list, and asserts the page text contains the literal `<script>` substring with no `<script>` element in the DOM (`expect(await page.locator('script').count()).toBe(0)` for the form view).

---

### 4.3 SUGGESTION

#### S-001 — `e2e/shared-counter.spec.ts:24` weak assertion masks race coverage

```ts
expect(statuses.some((s) => s === 429 || s === 401)).toBe(true);
```

Per RISK-003, after 4 sequential + 2 parallel failures (6 total), the shared counter sees count≥5 and BOTH parallel requests should return 429. Allowing `429 || 401` silently passes when serialized. Tighten to: `expect(statuses).toEqual([429, 429])` if you can deterministically share, or document and assert `(statuses as readonly number[]).filter((s) => s === 429).length >= 1`.

#### S-002 — `scripts/smoke-cold-start.ts:32` treats 401 as success for protected routes

```ts
return { latencyMs, status: response.status, ok: response.ok || response.status === 401 };
```

`/products` and `/alerts` require auth. A 401 from them isn't "Lambda cold start succeeded" — it might be an auth path bug, an expired token, or a misconfigured JWT secret. Replace with an explicit `auth-bypass` probe endpoint (e.g., `GET /healthz` — which is already shipped by PR 1 in `packages/backend/src/shared/health.ts`) and reserve the auth-required routes for separate, auth-warmed probes.

#### S-003 — `e2e/auth/login.spec.ts:55-69` test name should reflect what it actually does

The body runs "5 failures → 429 again" which is the same scenario as the previous test (just labelled differently). Rename to `429 still triggered after re-issuing same wrong password` or remove the duplicate.

#### S-004 — ADR files are stub-thin (~30-40 lines each); expand "Alternatives considered"

`docs/adr/0001..0007` follow the standard ADR template (Status / Context / Decision / Consequences) but the **Alternatives Considered** section is absent in every file. For future maintainers, including 2-3 rejected options per ADR (with one-sentence why) makes the architectural intent discoverable without re-reading the risk review.

---

### 4.4 Lint findings

| File                                                                        | Line       | Rule                                | Severity                         |
| --------------------------------------------------------------------------- | ---------- | ----------------------------------- | -------------------------------- |
| `e2e/shared-counter.spec.ts`                                                | 1:24       | `@typescript-eslint/no-unused-vars` | warning                          |
| `packages/backend/src/inventory/interface/handlers/record-movement.test.ts` | 4:10, 7:15 | `@typescript-eslint/no-unused-vars` | warning (pre-existing, not PR 4) |

PR 4 introduces the first one. Fix by switching to `import type { test, expect } from '@playwright/test'` and removing `request` from the value import. (The runtime `request` fixture is destructured per-test.)

---

## 5. Strict TDD check

Strict TDD is ACTIVE per `openspec/config.yaml → testing.strict_tdd`. PR 4 ships e2e specs + smoke scripts + docs/ADRs + READMEs. These do not produce production code that requires RED-first unit tests. The TDD gate from `apply-progress.md` covers PR 0's RED-first smoke tests only. PR 4 is **out of scope for strict-TDD verification by design**.

`tests/` files (e2e) are integration artifacts; the gate that matters for them is **runtime executability against a deployed dev URL**, which is not exercisable in this sandbox.

No CRITICAL on TDD compliance.

---

## 6. Review workload / PR boundary

- PR 4 stays inside the `e2e + smoke + docs` slice. No prod code, no migrations, no CDK changes.
- `git show --stat 1b76648` confirms: e2e specs, scripts/smoke-_, docs/adr/_, per-package READMEs, playwright.config.ts, lockfile increment only.
- No `size:exception` invoked; size is 2547 insertions which is large but expected for e2e suite.
- `Chain strategy: stacked-to-main` is respected (single commit on top of `feat(frontend): PR 3`).
- **No scope creep detected.** ✓

---

## 7. Task checkbox scan

```
openspec/changes/add-inventory-mvp/tasks.md — PR 4 section
```

All 26 PR 4 task lines are marked `[x]`. No `- [ ]` implementation tasks remain under PR 4. ✓

---

## 8. Commit hygiene

- `git log --oneline -20` → no `Co-Authored-By:` trailers, no AI attribution.
- `git log` shows conventional-commit prefixes (`chore:`, `feat:`, `fix:`, `test:`, `docs:`) on every commit.
- Husky pre-commit + commitlint config from PR 0 still wired (no PR 4 commit attempts to bypass).

---

## 9. Recommendation

**NOT READY FOR ARCHIVE.**

1. **Block:** fix C-001 (`cors-preflight.spec.ts` callable bug — runtime failure).
2. **Block:** fix C-002 (`list-movements.spec.ts` size boundary — runtime failure).
3. Address W-001..W-003 (auth Q-P4 / independent IP / window expiry scenarios) — these are spec scenarios not exercised by any current test.
4. Address W-004 (XSS test only proves API storage, not SPA render safety).
5. Apply S-001..S-004 as polish (low cost).

Once C-001 + C-002 + W-001..W-003 land, re-run `pnpm exec playwright test` against the dev stage URL and confirm the suite is green end-to-end. Then archive.

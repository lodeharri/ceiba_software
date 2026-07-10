# Verify Report — add-localstack-dev-env

**Status:** ❌ FAIL (CRITICAL blockers present)
**Date:** 2026-07-10
**Verifier:** sdd-verify (Gentle AI)

## Summary

The change installs the local dev stack end-to-end: stage flags, RDS/CloudFront skip logic, compose + deployer + frontend images, env-driven config. Tests, type-checks, and CDK synth for both stages are GREEN. However, several implementation gaps break the AC-1 single-command boot, AC-12 zero hardcoded values, AC-13 port override without code edits, REQ-deployer secret masking, and AC-18 plain `down` preserving data.

**Counts:** CRITICAL 5 · WARNING 4 · SUGGESTION 3

---

## 1. Static verification

| #    | Check                                                                       | Result                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `docker-compose.dev.yml` with 4 services                                    | ✅ PASS               | `postgres`, `localstack`, `deployer`, `frontend` present (`docker-compose.dev.yml` lines 15, 45, 79, 126)                                                                                                                                                                                                                                                                                                                                            |
| 1.2  | `docker/postgres-init/01-pgvector.sql` with CREATE EXTENSION                | ✅ PASS               | `CREATE EXTENSION IF NOT EXISTS vector` + `pgcrypto`                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.3  | `docker/deployer/Dockerfile` and `entrypoint.sh`                            | ✅ PASS               | Both exist, entrypoint executable (`-rwxr-xr-x`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.3b | `docker/deployer/wait-for-services.sh`                                      | ❌ CRITICAL — MISSING | `find docker/` shows only `Dockerfile` and `entrypoint.sh`. Design §3.5 specifies this script with `wait_for_postgres` + `wait_for_localstack` (jq-based service availability check). Without it, the deployer only waits for HTTP 200 on `/_localstack/health` and NOT for required services (`lambda,apigateway,secretsmanager,ssm,iam,cloudformation,sts`). First deploy race = silent failure.                                                   |
| 1.4  | `docker/frontend/Dockerfile`                                                | ⚠️ WARNING            | Exists but CMD hardcodes `5173` and ignores `FRONTEND_PORT`/`VITE_HOST` env vars.                                                                                                                                                                                                                                                                                                                                                                    |
| 1.4b | `docker/frontend/entrypoint.sh`                                             | ❌ CRITICAL — MISSING | `find docker/` confirms absence. Design §3.7 specifies a script that waits for `API_URL_FILE`, exports `VITE_API_BASE_URL`, then launches `pnpm dev`. Current implementation: Vite starts with the env-var fallback URL only — if the deployer hasn't written the file yet (it always takes seconds), `VITE_API_BASE_URL=http://${API_GATEWAY_HOST_EXTERNAL}:${API_GATEWAY_PORT}` (default `http://localhost:4566`) is baked in and never refreshed. |
| 1.5  | `.env.dev.example` with all vars                                            | ✅ PASS               | 2845 bytes, all required vars documented (ver manually by inspection)                                                                                                                                                                                                                                                                                                                                                                                |
| 1.6  | `docs/LOCAL-DEV.md`                                                         | ✅ PASS               | 1786 bytes, quickstart + troubleshooting + reset                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.7  | `scripts/dev-up.sh` and `scripts/dev-down.sh` executable                    | ✅ PASS               | `-rwxr-xr-x`, `bash -n` exit 0                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.8  | `.gitignore` includes `.env.dev`, `.env.dev.local`, `.api-url`, `cdk.out/`  | ✅ PASS               | lines 11 (`cdk.out/`), 44 (`.env.dev`), 45 (`.env.dev.local`), 46 (`.api-url`), 47 (`cdk.out/` duplicate); `.env.dev.example` excluded on line 24                                                                                                                                                                                                                                                                                                    |
| 1.9  | `packages/infra/src/config.ts` has `'localstack'` in Stage union            | ✅ PASS               | Line 19: `export type Stage = 'dev' \| 'prod' \| 'localstack'`; tables extended                                                                                                                                                                                                                                                                                                                                                                      |
| 1.10 | `packages/infra/src/app.ts` skips RDS/CloudFront conditionally              | ✅ PASS               | `src/app.ts` EXISTS, `bin/app.ts` does not (design explicitly notes this). Lines 76–77 set `skipRds` and `skipCloudFront` from `stage === 'localstack'` OR context flag                                                                                                                                                                                                                                                                              |
| 1.11 | `packages/frontend/vite.config.ts` reads `VITE_API_BASE_URL` dynamically    | ✅ PASS               | `define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(readApiBaseUrl()) }`, port from `process.env.FRONTEND_PORT` with default 5173                                                                                                                                                                                                                                                                                                         |
| 1.12 | `packages/backend/src/shared/prisma-client.ts` sslmode conditional by stage | ✅ PASS               | Line 79: `url.searchParams.set('sslmode', stage === 'localstack' ? 'disable' : 'require')`                                                                                                                                                                                                                                                                                                                                                           |

## 2. Syntax verification

| #   | Command                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `bash -n docker/deployer/entrypoint.sh`                                     | ✅ exit 0                                                                                                                                                                                                                                                                                                                                                                             |
| 2.2 | `bash -n scripts/dev-up.sh`                                                 | ✅ exit 0                                                                                                                                                                                                                                                                                                                                                                             |
| 2.3 | `bash -n scripts/dev-down.sh`                                               | ✅ exit 0                                                                                                                                                                                                                                                                                                                                                                             |
| 2.4 | `docker compose -f docker-compose.dev.yml config` (with `.env.dev` present) | ❌ CRITICAL — exit 1 with: `env file /…/.env.dev.local not found`. The design specifies `required: false` for `.env.dev.local` (long-form `env_file:` entry); the implementation uses the short list form which is mandatory. Spec REQ-env-config "Missing local override is non-fatal" therefore fails. Tested workaround: creating an empty `.env.dev.local` makes `config` exit 0. |

> Note: `scripts/dev-up.sh` masks this by copying `.env.dev.example` to `.env.dev.local` if missing — that path "fixes" the boot but pollutes the developer filesystem with an unwanted file and defeats the purpose of `.env.dev.local` as opt-in overrides.

## 3. Test verification

| Package    | Files | Tests | Result                 |
| ---------- | ----- | ----- | ---------------------- |
| `infra`    | 10    | 67    | ✅ all passed (27.57s) |
| `backend`  | 62    | 272   | ✅ all passed (5.51s)  |
| `frontend` | 16    | 54    | ✅ all passed (6.58s)  |

Notable test signal: `infra` includes the new `ApiStack › PR 2 — carries DATABASE_URL as a literal URL when databaseSource.kind=plain-env` covering localstack DATABASE_URL indirection.

## 4. CDK synth verification

| Stage      | Command                                                    | Stacks synthed                                                                         | RDS/CloudFront resources                | Result  |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| localstack | `cdk synth --context stage=localstack`                     | `MercadoExpress-localstack-Api`, `MercadoExpress-localstack-Observability` (2)         | 0 in either template                    | ✅ PASS |
| dev        | `cdk synth --context stage=dev --output /tmp/cdk-dev-test` | `…-Database` (2 RDS hits), `…-Frontend` (1 CloudFront), `…-Api`, `…-Observability` (4) | RDS in Database, CloudFront in Frontend | ✅ PASS |

The dev synth emitted a CLI warning: `Cloud assembly schema version mismatch … 54.0.0`. Cosmetic, does not affect the output, but suggests the local CLI is one minor behind the library.

## 5. Type-check verification

`pnpm -r exec tsc --noEmit` → exit 0 (all four packages clean).

## 6. Findings

### CRITICAL — must fix before archive

- **C-1** `docker/deployer/wait-for-services.sh` missing (design §3.5). The entrypoint only does a generic `curl /_localstack/health` and `pg_isready` — it does NOT verify the configured `LOCALSTACK_REQUIRED_SERVICES=…` list. Failure mode: first-boot race where `/health` returns 200 but `secretsmanager` / `iam` are not yet registered → `cdk deploy` crashes. Spec REQ-DEPLOY-1 violated.
- **C-2** `docker/frontend/entrypoint.sh` missing (design §3.7). Vite is started via the Dockerfile's CMD with `5173` and `--host 0.0.0.0` hardcoded. Spec REQ-local-dev-env "Vite reads VITE_API_BASE_URL at container start" and "Fallback when the shared file is missing" cannot be satisfied. Result: browser traffic goes to whatever `VITE_API_BASE_URL` was set to in the env file (fallback `http://localhost:4566`), not the URL produced by the deployer.
- **C-3** `docker/deployer/entrypoint.sh` swallows `cdk deploy` failures with `|| echo "⚠️ Some stacks failed (this may be expected)"`. This breaks `restart: on-failure`, masks the very risks R-1 / R-2 / R-7 the design mitigates, and contradicts design §3.4 "Failure behavior: cdk deploy failure: exit non-zero so Docker restart: on-failure retries."
- **C-4** `docker/deployer/entrypoint.sh` uses `python3` for JSON parsing. The deployer image only installs `bash curl jq postgresql-client` (design §3.3 / Dockerfile). Runtime failure on first boot. Plan-called-for `jq` is the required tool.
- **C-5** `scripts/dev-down.sh` defaults to `down -v`. AC-18 says "Zero side effects at down: the DB local is preserved (volumen con nombre) for not losing work between sessions." Spec REQ-local-dev-env "Plain down keeps the data" requires plain `down` to preserve `pgdata`. Implementation inverts that contract.

### WARNING — should fix soon

- **W-1** `docker-compose.dev.yml` uses short `env_file: [.env.dev, .env.dev.local]` which makes `.env.dev.local` mandatory on this Compose version (`v2.40.3-desktop.1`). Design explicitly required long-form `{ path: …, required: false }` per spec REQ-env-config "Missing local override is non-fatal".
- **W-2** `docker/deployer/entrypoint.sh` logs `DATABASE_URL=${DATABASE_URL}` unmasked on startup. Design §3.4 spec'd a `mask_value` helper that masks `*PASSWORD*|*SECRET*|*TOKEN*|DATABASE_URL`. REQ-deployer "Stage and endpoint are highlighted" with secret masking violated. Real credential leak to log streams.
- **W-3** `docker/deployer/entrypoint.sh` hardcodes `postgres` as PostgreSQL host in `pg_isready -h postgres …`. Should use `${POSTGRES_HOST}`. Violates AC-11 (zero hardcoded URLs).
- **W-4** `docker/deployer/entrypoint.sh` writes a fallback API URL on JSON-parse error: `print('http://${LOCALSTACK_HOST}:${LOCALSTACK_PORT}')` — silently emits a wrong URL. REQ-deployer "Missing API URL is a hard failure" violated (also: container stays up healthy with a non-functional endpoint).

### SUGGESTION — polish

- **S-1** `docker/deployer/entrypoint.sh` lacks the `required_vars` validation loop from design §3.4. Add it for early failure on missing config.
- **S-2** `docker/frontend/Dockerfile` uses `pnpm install --frozen-lockfile || pnpm install` — fall-back to `pnpm install` silently masks lockfile drift. Consider failing the build instead.
- **S-3** Duplicate `cdk.out/` entry in `.gitignore` (lines 11 and 47). Trivial cleanup.

## 7. Spec / AC coverage

| AC    | Description                                                           | Status     | Notes                                                                                                                                 |
| ----- | --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | `docker compose -f … up -d` boots all 4 services with no manual steps | ❌ FAIL    | Fails today because `.env.dev.local` not present triggers hard error; `scripts/dev-up.sh` works around it by copying the example file |
| AC-2  | PostgreSQL with pgvector                                              | ✅ PASS    | `01-pgvector.sql` creates `vector` + `pgcrypto`                                                                                       |
| AC-3  | LocalStack with required services                                     | ⚠️ PARTIAL | Health endpoint check exists; required-services precondition NOT enforced (see C-1)                                                   |
| AC-4  | `cdk deploy` runs automatically                                       | ✅ PASS    | deployer entrypoint invokes cdk                                                                                                       |
| AC-5  | Lambdas respond to `${API_GATEWAY_PORT}`                              | ✅ PASS    | depends on API_URL file write                                                                                                         |
| AC-6  | Frontend accessible on `${FRONTEND_PORT}`                             | ⚠️ PARTIAL | Dockerfile hardcodes 5173; port override breaks                                                                                       |
| AC-7  | `VITE_API_BASE_URL` from `.api-url`                                   | ❌ FAIL    | No entrypoint reads the file; Vite uses compose-time env var only                                                                     |
| AC-8  | Migrations run via custom resource                                    | ✅ PASS    | `migrations-lambda.ts` branches on `STAGE=localstack`                                                                                 |
| AC-9  | `DATABASE_URL` read from env on localstack                            | ✅ PASS    | synth confirms literal `DATABASE_URL` on lambdas; covered by test `ApiStack › PR 2 …`                                                 |
| AC-10 | `JWT_SECRET` read from env on localstack                              | ✅ PASS    | synth + app.ts confirm plain-env jwtSource                                                                                            |
| AC-11 | Zero URLs hardcoded                                                   | ⚠️ PARTIAL | `entrypoint.sh` hardcodes `postgres` host; compose uses `${VAR}` correctly                                                            |
| AC-12 | Zero ports hardcoded                                                  | ❌ FAIL    | `Dockerfile` frontend CMD hardcodes `--port 5173`; prisma-client uses derived port OK                                                 |
| AC-13 | Port override without code edits                                      | ❌ FAIL    | Overriding `FRONTEND_PORT` to e.g. 5174 does not affect the container-internal Vite port                                              |
| AC-14 | Same CDK code for both stages                                         | ✅ PASS    | both synths succeed; RDS/CloudFront skip is conditional                                                                               |
| AC-15 | `docs/LOCAL-DEV.md` covers setup/troubleshooting                      | ✅ PASS    | present, but missing explicit `cdk.out/` and `.docker-shared/` references                                                             |
| AC-16 | `.env.dev` defaults work, `.env.dev.local` for overrides              | ⚠️ PARTIAL | `dev-up.sh` copies `.env.dev.example` to `.env.dev.local`, defeating the opt-in semantic                                              |
| AC-17 | Compose stops with `down`, `-v` for clean                             | ⚠️ PARTIAL | `scripts/dev-down.sh` makes `-v` the default                                                                                          |
| AC-18 | Plain `down` keeps DB                                                 | ❌ FAIL    | `scripts/dev-down.sh` defaults to `-v` (see C-5)                                                                                      |

## 8. Review workload / PR boundary

The change was intended to ship in 4 PRs (≈820 LOC). The repo does not show PR history, but a single-shot apply is consistent with the design. No evidence of scope creep beyond the 4-PR plan, but the deployer / frontend images are not yet "fully finished" (missing scripts documented in design).

## 9. Strict TDD / Assertion quality

No strict-TDD evidence block present in `apply-progress` (not retrieved in this session — outside scope; the SDD phase was likely executed without strict TDD). Tests added have real assertions (e.g., `DATABASE_URL` as literal URL for plain-env databaseSource; `sslmode=disable` for localstack; CORS origin). No smoke-only or tautology tests observed in the changed files.

## 10. Verdict

**Not ready for archive.** CRITICAL findings C-1 through C-5 each block an AC or a design-contract scenario. Re-run `sdd-apply` with the missing pieces, then re-verify.

Recommended fix order (smallest blast radius first):

1. Add `docker/deployer/wait-for-services.sh` and call it from entrypoint.
2. Add `docker/frontend/entrypoint.sh` and reference it from the Dockerfile `ENTRYPOINT`.
3. Remove the `|| echo "⚠️…"` swallow in `docker/deployer/entrypoint.sh`; switch JSON parsing to `jq`.
4. Change `scripts/dev-down.sh` to default `down`, expose a `-v` flag.
5. Mask `DATABASE_URL` in startup logs.

---

**Artifacts:** `openspec/changes/add-localstack-dev-env/verify-report.md`
**Next recommended:** `sdd-apply` for the missing scripts and fix-up patch, then a second `sdd-verify` pass.

# Docs Rewrite Specification

## Purpose

Rewrites `docs/LOCAL-DEV.md` to describe the new dev flow (one `pnpm dev` that
brings up postgres, localstack, the dev server, and Vite) and updates
`README.md`'s "Local development" section to point at the new doc. Removes
every reference to the deleted sidecars (`deployer`, `s3-proxy`), the deleted
volume (`shared-data`), the deleted file (`/shared/.api-url`), and the removed
env vars (`LOCALSTACK_BIND_HOST`, `AWS_ENDPOINT_URL_S3`, `API_GATEWAY_HOST_EXTERNAL`).
Also marks `openspec/changes/add-localstack-dev-env/proposal.md` as superseded.
The result: the next developer who clones the repo runs `pnpm dev` and gets a
working stack with no out-of-date instructions to ignore.

## Domain primitives

| Doc / file                                                             | Owned here | Consumed by                      |
| ---------------------------------------------------------------------- | ---------- | -------------------------------- |
| `docs/LOCAL-DEV.md`                                                    | yes        | new devs, README link            |
| `README.md` "Local development" section                                | yes        | first page most visitors land on |
| `openspec/changes/add-localstack-dev-env/proposal.md` supersede marker | yes        | audit trail of the old change    |

## Requirements

### Requirement: docs/LOCAL-DEV.md documents pnpm dev as the one command

The `docs/LOCAL-DEV.md` file MUST document `pnpm dev` as the canonical
first-run command. The doc MUST explain each of the four `pnpm dev:*`
sub-commands and what they do in isolation. The doc MUST NOT mention
`deployer`, `s3-proxy`, `scripts/dev-up.sh`, `scripts/dev-down.sh`, or any
sidecar from the old flow.

#### Scenario: First-run section uses pnpm dev

- GIVEN the rewritten `docs/LOCAL-DEV.md`
- WHEN the "First run" (or equivalent top section) is read
- THEN the first command a reader sees is `pnpm dev`, followed by the
  expected outcome (a table or list mentioning postgres, localstack, the dev
  server, and Vite). No mention of `deployer`, `s3-proxy`, `cdk bootstrap`,
  `cdk deploy`, `shared-data`, `/shared/.api-url`, or `LOCALSTACK_BIND_HOST`.

#### Scenario: Sub-commands documented

- GIVEN the rewritten doc
- WHEN the "What runs where" (or equivalent) section is read
- THEN it describes `pnpm dev:up` (docker compose up -d), `pnpm dev:api`
  (native dev server), `pnpm dev:web` (Vite), and `pnpm dev` (the concurrent
  combination), each with a one-line purpose and the port it binds

#### Scenario: Old sidecar terms are absent

- GIVEN the rewritten doc
- WHEN `grep -nE 'deployer|s3-proxy|shared-data|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3' docs/LOCAL-DEV.md`
  is run
- THEN no matches are returned

### Requirement: README.md "Local development" links to docs/LOCAL-DEV.md

The `README.md` "Local development" section MUST point readers at
`docs/LOCAL-DEV.md` (relative link or absolute path) as the source of truth
for local setup. The section MUST NOT duplicate the long form of the setup
instructions, and MUST NOT mention any of the removed sidecar terms.

#### Scenario: README links to the local dev doc

- GIVEN the updated `README.md`
- WHEN the "Local development" section is read
- THEN it contains a link to `docs/LOCAL-DEV.md` and a one-line summary
  ("run `pnpm dev` — see `docs/LOCAL-DEV.md` for details")

#### Scenario: README has no removed sidecar terms

- GIVEN the updated `README.md`
- WHEN `grep -nE 'deployer|s3-proxy|shared-data|/shared/\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3' README.md`
  is run
- THEN no matches are returned

### Requirement: add-localstack-dev-env is marked superseded

The file `openspec/changes/add-localstack-dev-env/proposal.md` MUST contain
the line `## Status: superseded by replace-localstack-dev-server on 2026-07-10`
as a top-level section. The original proposal body MUST NOT be rewritten or
deleted in this change.

#### Scenario: Supersede marker is present

- GIVEN the file at `openspec/changes/add-localstack-dev-env/proposal.md`
- WHEN `grep -n 'Status: superseded by replace-localstack-dev-server' openspec/changes/add-localstack-dev-env/proposal.md`
  is run
- THEN exactly one match is returned, located at or near the top of the file

#### Scenario: Original body is preserved

- GIVEN the superseded proposal
- WHEN the file is read
- THEN the original proposal body (intact from before this change) is still
  present below the supersede marker — only a one-line append was made

### Requirement: Troubleshooting section covers the common dev-time failures

The `docs/LOCAL-DEV.md` MUST include a "Troubleshooting" (or similarly
named) section that addresses, at minimum: stale LocalStack state from a
previous run, stale Vite cache, `VITE_API_BASE_URL` missing at build time,
port collisions on 3001/4566/5173/5432, and how to reset (`pnpm dev:down`,
`docker compose down -v`, `pnpm -C packages/frontend dev --force`).

#### Scenario: Troubleshooting covers each known failure mode

- GIVEN the rewritten doc
- WHEN the troubleshooting section is read
- THEN at minimum the following cases are addressed with a one-paragraph fix
  each: (a) LocalStack container keeps old state — fix `docker compose down -v`;
  (b) Vite serves stale module — fix clear `.vite` cache or `dev --force`;
  (c) Build fails with the missing-env message — fix set `VITE_API_BASE_URL`;
  (d) Port already in use — fix identify the holder and stop it; (e) DB not
  ready when dev:api starts — fix wait for healthcheck

#### Scenario: Reset path is documented

- GIVEN the rewritten doc
- WHEN a reader searches for "reset"
- THEN they find a `pnpm dev:reset` (or `docker compose down -v`) command and
  the precise list of state it clears (containers, volumes, Vite cache)

## Edge cases

- **EC-1 — Diagram or screenshot in the old doc.** If the pre-change
  `docs/LOCAL-DEV.md` contained images or ASCII diagrams referencing the old
  flow, those MUST be removed (they are now misleading). Replacement visuals
  are out of scope for this change.
- **EC-2 — Internal links to old anchors.** If the README's "Local development"
  section previously linked to a specific heading in `docs/LOCAL-DEV.md` (e.g.
  `#first-run-with-deployer`), the link MUST be updated to the new heading or
  removed. A `grep -nE 'deployer|s3-proxy' README.md docs/LOCAL-DEV.md`
  round-trip MUST return 0 matches.
- **EC-3 — Translation/i18n.** The MercadoExpress project keeps UI strings in
  Spanish per `config.yaml`, but documentation follows the codebase default
  (English). This spec does not require a Spanish translation of `LOCAL-DEV.md`;
  if the team wants one, that is a separate change.

## Non-functional requirements

- **NFR-1 — Document length.** `docs/LOCAL-DEV.md` SHOULD be ≤ 250 lines
  (progressive disclosure — quick path first, details second, deep dives last).
- **NFR-2 — Cognitive load.** Following the cognitive-doc-design skill, the
  doc MUST lead with the answer (`pnpm dev`) and only then add context.
  Headings MUST be in a stable order (Prerequisites → First run → What runs
  where → Troubleshooting → Reset) so a returning reader can scan.

## Open questions for design

- **OQ-DOC-1 (design):** `pnpm dev:reset` command shape — one combined command
  that clears containers + volumes + Vite cache, or three separate commands?
  (Proposal Q-D4.) Affects the doc text only.

## Acceptance scenario summary

| Requirement                  | Pass condition                                                               |
| ---------------------------- | ---------------------------------------------------------------------------- |
| REQ-DOC-1 (one-command boot) | `pnpm dev` is the first command in the rewritten doc; sub-commands explained |
| REQ-DOC-2 (README link)      | README's "Local development" section links to `docs/LOCAL-DEV.md`            |
| REQ-DOC-3 (supersede marker) | `add-localstack-dev-env/proposal.md` carries the one-line supersede marker   |
| REQ-DOC-4 (troubleshooting)  | Five named failure modes are addressed with fixes                            |

## Out of scope for this change

- Rewriting or expanding other doc files (`docs/ARCHITECTURE.md`,
  `docs/DEPLOYMENT.md`, etc.) — those are owned by other changes.
- Translating `docs/LOCAL-DEV.md` to Spanish.
- Adding screenshots, GIFs, or video walkthroughs.
- Generating API reference docs from OpenAPI (no OpenAPI spec exists yet).
- Removing the old `add-localstack-dev-env` folder from disk — the supersede
  marker is the only edit.

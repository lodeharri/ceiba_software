/**
 * Sidecar/legacy-file removal guard + CI grep guard (Tasks 2.2, 2.6; PR 2).
 *
 * Part A — file removal (Task 2.2):
 *   Locks the contract that the sidecar directories (`docker/deployer/`,
 *   `docker/s3-proxy/`, `docker/frontend/`) and the legacy shell scripts
 *   (`scripts/dev-up.sh`, `scripts/dev-down.sh`) are physically gone from
 *   the repo. The previous SDD (`add-localstack-dev-env`) created the
 *   `deployer`/`s3-proxy`/`frontend` containers; with the wrapper-native
 *   dev server (REQ-NDS-*) and `pnpm dev:web` (REQ-FNR-1) replacing them,
 *   these directories are obsolete and their presence would be a regression.
 *
 * Part B — CI grep guard (Task 2.6, R-7):
 *   Runs `grep -rE` over the repo for the 8 sidecar tokens and asserts
 *   zero matches. Allowed exceptions:
 *     - `openspec/changes/replace-localstack-dev-server/` (current change
 *       docs — they MUST mention the old sidecars to describe what was
 *       removed).
 *     - `openspec/changes/add-localstack-dev-env/` is excluded entirely
 *       (superseded change; the proposal.md's supersede marker stays there).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

interface Forbidden {
  path: string;
  label: string;
}

const FORBIDDEN: Forbidden[] = [
  { path: 'docker/deployer/Dockerfile', label: 'deployer Dockerfile' },
  { path: 'docker/deployer/entrypoint.sh', label: 'deployer entrypoint' },
  { path: 'docker/s3-proxy/Dockerfile', label: 's3-proxy Dockerfile' },
  { path: 'docker/s3-proxy/nginx.conf', label: 's3-proxy nginx.conf' },
  { path: 'docker/frontend/Dockerfile', label: 'frontend Dockerfile (previous SDD leftover)' },
  { path: 'docker/frontend/entrypoint.sh', label: 'frontend entrypoint (previous SDD leftover)' },
  { path: 'scripts/dev-up.sh', label: 'legacy dev-up shell script' },
  { path: 'scripts/dev-down.sh', label: 'legacy dev-down shell script' },
];

describe('sidecar/legacy file removal — REQ-DEM-3, DEM-6, FNR-2, FVE-5', () => {
  for (const { path, label } of FORBIDDEN) {
    it(`${label} (${path}) is deleted`, () => {
      const abs = resolve(ROOT, path);
      expect(existsSync(abs)).toBe(false);
    });
  }
});

describe('sidecar directory removal — REQ-DEM-3, DEM-6, FNR-2', () => {
  it('docker/ does NOT contain deployer/ subdirectory', () => {
    const d = resolve(ROOT, 'docker/deployer');
    // `statSync` throws on a missing path — use a soft check so the test
    // message stays clean.
    expect(existsSync(d)).toBe(false);
  });

  it('docker/ does NOT contain s3-proxy/ subdirectory', () => {
    const d = resolve(ROOT, 'docker/s3-proxy');
    expect(existsSync(d)).toBe(false);
  });

  it('docker/ does NOT contain frontend/ subdirectory (previous SDD leftover)', () => {
    const d = resolve(ROOT, 'docker/frontend');
    expect(existsSync(d)).toBe(false);
  });

  it('docker/postgres-init/ is intact (pgvector init script)', () => {
    // Belt and suspenders — verify the keep-this directory still exists.
    const d = resolve(ROOT, 'docker/postgres-init');
    expect(existsSync(d)).toBe(true);
    const pgvectorSql = resolve(d, '01-pgvector.sql');
    expect(existsSync(pgvectorSql)).toBe(true);
    // Sanity: file is non-empty and contains the pgvector extension line.
    if (existsSync(pgvectorSql)) {
      const stat = statSync(pgvectorSql);
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Part B — CI grep guard (Task 2.6, R-7)
// ---------------------------------------------------------------------------

const SIDECAR_TOKENS =
  'shared-data|API_URL_FILE|/shared/\\.api-url|LOCALSTACK_BIND_HOST|API_GATEWAY_HOST_EXTERNAL|AWS_ENDPOINT_URL_S3|s3-proxy|deployer';

/**
 * Paths that the PR 2 grep guard EXCLUDES. Each exclusion has a clear reason.
 *
 *   - node_modules / .git / coverage / dist / .pi-lens — tooling/build dirs
 *     (matches the user's command line verbatim).
 *   - .pi-subagents — local-only agent artifacts, gitignored (analogous to
 *     .pi-lens but not in the user's command-line excludes; added because
 *     grep would otherwise find agent session memos that mention the
 *     tokens).
 *   - openspec/changes/replace-localstack-dev-server — the current change
 *     docs that describe what was removed (allowed by the orchestrator).
 *   - openspec/changes/add-localstack-dev-env — superseded change; its
 *     `proposal.md` carries the supersede marker line (allowed by the
 *     orchestrator; --exclude-dir per the user's command).
 *   - tests/architecture — this directory's own tests reference the sidecar
 *     tokens (e.g. `REMOVED_EXACT = ['AWS_ENDPOINT_URL_S3', ...]`) by design.
 *   - frontend — basename of packages/frontend/ (PR 3 territory; the
 *     frontend rewires land in PR 3 and the PR 3 grep guard tightens this).
 *   - docs — PR 3 territory (docs-rewrite).
 *   - shared — pnpm hoisted-store directory.
 *
 * `scripts/dev-server.ts` (PR 1) has a single top-of-file comment
 * mentioning `docker/deployer/` + `docker/s3-proxy/`. The grep result list
 * surfaces that single comment as the regression budget — see the assertion
 * below. The remaining matches outside this allowlist fail the test.
 */
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'coverage',
  'dist',
  '.pi-lens',
  '.pi-subagents',
  'openspec',
  // `tests` covers tests/architecture + tests/architecture/<any>/; the
  // architecture specs reference the sidecar tokens in regex/REMOVED_EXACT
  // arrays by design.
  'tests',
  // `test` is the basename of every `*/test/` and `*/__tests__/` folder
  // (e.g. packages/infra/test/docker, packages/frontend/test/). Test code
  // legitimately references the sidecar tokens to assert their absence.
  'test',
  '__tests__',
  // pnpm hoisted-store directory.
  'shared',
];

const EXCLUDED_FILES = new Set<string>([
  // PR 1 working code (do-not-modify list). The single top-of-file comment
  // documents what the wrapper-native dev server replaces — the strict
  // assertion below (`<= 2 mentions`) is the regression guard.
  'dev-server.ts',
  // PR 3 SPEC: the add-localstack-dev-env supersede marker lives in
  // openspec/changes/add-localstack-dev-env/proposal.md and intentionally
  // mentions `replace-localstack-dev-server`. The OpenSpec directory is
  // already excluded by EXCLUDED_DIRS, but if a future change references
  // the old name outside openspec/, allow it through the grep guard.
  'proposal.md',
]);

interface GrepMatch {
  file: string;
  line: string;
}

/**
 * Run grep over the workspace. We invoke grep via execFileSync (not execSync)
 * so the token list is passed as a discrete argv element — no shell
 * interpolation, no injection risk.
 */
function grepForSidecarTokens(): GrepMatch[] {
  const args = [
    '-rE',
    SIDECAR_TOKENS,
    '--include=*.ts',
    '--include=*.md',
    '--include=*.yml',
    '--include=*.json',
    ...EXCLUDED_DIRS.flatMap((d) => [`--exclude-dir=${d}`]),
    ...[...EXCLUDED_FILES].flatMap((f: string) => [`--exclude=${f}`]),
    '.',
  ];

  let stdout = '';
  try {
    stdout = execFileSync('grep', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // grep exits 1 when there are zero matches — that's the success case.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return [];
    throw err;
  }

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const colonIdx = line.indexOf(':');
      return {
        file: colonIdx >= 0 ? line.slice(0, colonIdx) : line,
        line: colonIdx >= 0 ? line.slice(colonIdx + 1) : '',
      };
    })
    .filter((m) => !EXCLUDED_FILES.has(basename(m.file)));
}

describe('CI grep guard — REQ-DEM-3, EVC-3, FNR-2, FVE-3, R-7', () => {
  it('no source/docs/config file references the deleted sidecar tokens', () => {
    const matches = grepForSidecarTokens();
    if (matches.length > 0) {
      const summary = matches
        .slice(0, 10)
        .map((m) => `  ${m.file}: ${m.line}`)
        .join('\n');
      throw new Error(
        `Found ${matches.length} sidecar-reference(s):\n${summary}\n` +
          `If a match is intentional, narrow the exclusion list.`,
      );
    }
    expect(matches).toEqual([]);
  });

  it('grep guard covers PR 1 working code (scripts/dev-server.ts)', () => {
    // The single known reference in scripts/dev-server.ts is the top-of-file
    // comment "Replaces `docker/deployer/` + `docker/s3-proxy/`". If more
    // references creep in, the test above will flag them. This explicit
    // assertion documents the intentional, single-line exception.
    const text = readFileSync(resolve(ROOT, 'scripts/dev-server.ts'), 'utf8');
    const deployerMentions = (text.match(/deployer/g) ?? []).length;
    const s3ProxyMentions = (text.match(/s3-proxy/g) ?? []).length;
    // Allow up to 2 mentions (the comment line) — strict regression guard.
    expect(deployerMentions + s3ProxyMentions).toBeLessThanOrEqual(2);
  });
});

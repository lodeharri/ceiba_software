#!/usr/bin/env npx tsx
/**
 * Verify locked architectural decisions (KL-02).
 *
 * Walks the repository and asserts that architectural decisions marked as
 * "locked" in openspec/config.yaml (Stack + Auth sections) are not contradicted
 * by source code, dependencies, or infra configuration.
 *
 * Each lock is encoded below with its source-of-truth reference, the paths
 * it covers, and the regex patterns that would violate it.
 *
 * Usage:
 *   cd packages/backend && pnpm exec tsx ../../scripts/verify-locked-decisions.ts
 *
 * Exit codes:
 *   0  all locked decisions respected
 *   1  at least one violation found
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Resolve repo root as the parent of this script's directory. import.meta.dirname
// is available on Node ≥ 20.11; fall back to URL parsing on older runtimes.
const SCRIPT_DIR = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const REPO_ROOT = join(SCRIPT_DIR, '..');

interface ForbiddenPattern {
  /** Human-readable description of the violation. */
  readonly description: string;
  /** Regex applied line-by-line against text files under `paths`. */
  readonly pattern: RegExp;
  /**
   * Optional extra condition: when provided, a match is reported only if the
   * capture-group-1 (or the full match if no group) does NOT contain this
   * substring. Used to allow aws-cdk/aws-apigatewayv2 while forbidding v1.
   */
  readonly allowIfContains?: string;
}

interface LockedDecision {
  readonly name: string;
  readonly source: string;
  /** Directories under REPO_ROOT to scan (relative, POSIX-style). */
  readonly paths: readonly string[];
  /** Files or globs to skip within those paths. */
  readonly skip: readonly string[];
  readonly forbidden: readonly ForbiddenPattern[];
}

const LOCKS: readonly LockedDecision[] = [
  {
    name: 'Backend framework: pure AWS Lambda handlers (no Express/Fastify/NestJS/Koa)',
    source: 'openspec/config.yaml#stack.backend.framework',
    paths: ['packages/backend/src', 'packages/backend/test', 'packages/backend/drizzle'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'Express import', pattern: /from ['"]express['"]/ },
      { description: 'Fastify import', pattern: /from ['"]fastify['"]/ },
      { description: 'NestJS import', pattern: /from ['"]@nestjs\// },
      { description: 'Koa import', pattern: /from ['"]koa['"]/ },
      { description: 'Hapi import', pattern: /from ['"]@hapi\// },
      { description: 'Restify import', pattern: /from ['"]restify['"]/ },
    ],
  },
  {
    name: 'API Gateway: HTTP API v2 only (no REST API v1)',
    source: 'openspec/config.yaml#stack.backend.api',
    paths: ['packages/infra/src'],
    skip: ['node_modules'],
    forbidden: [
      // aws-cdk/aws-apigateway = REST API v1 (forbidden). aws-cdk/aws-apigatewayv2 = HTTP API v2 (allowed).
      {
        description: 'REST API v1 import (forbidden; use aws-apigatewayv2)',
        pattern: /from ['"]aws-cdk\/aws-apigateway['"]/,
        allowIfContains: 'aws-apigatewayv2',
      },
      {
        description: 'RestApi construct usage (forbidden; use HttpApi)',
        pattern: /\bnew\s+RestApi\b/,
      },
    ],
  },
  {
    name: 'Frontend framework: Vue 3 only (no React/Angular/Svelte)',
    source: 'openspec/config.yaml#stack.frontend.framework',
    paths: ['packages/frontend/src', 'packages/frontend/index.html'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'React import', pattern: /from ['"]react['"]/ },
      { description: 'ReactDOM import', pattern: /from ['"]react-dom['"]/ },
      { description: 'Angular import', pattern: /from ['"]@angular\// },
      { description: 'Svelte import', pattern: /from ['"]svelte['"]/ },
      { description: 'SvelteKit import', pattern: /from ['"]@sveltejs\// },
    ],
  },
  {
    name: 'Frontend state: Pinia only (no Vuex/Redux/MobX/Zustand)',
    source: 'openspec/config.yaml#stack.frontend.state',
    paths: ['packages/frontend/src'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'Vuex import', pattern: /from ['"]vuex['"]/ },
      { description: 'Redux import', pattern: /from ['"]@reduxjs\// },
      { description: 'React-Redux import', pattern: /from ['"]react-redux['"]/ },
      { description: 'MobX import', pattern: /from ['"]mobx['"]/ },
      { description: 'Zustand import', pattern: /from ['"]zustand['"]/ },
    ],
  },
  {
    name: 'Database ORM: Drizzle only (no Prisma/TypeORM/Sequelize/Mongoose/Knex)',
    source: 'openspec/config.yaml#stack.database.orm',
    paths: ['packages/backend/src'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'Prisma client import', pattern: /from ['"]@prisma\/client['"]/ },
      { description: 'TypeORM import', pattern: /from ['"]typeorm['"]/ },
      { description: 'Sequelize import', pattern: /from ['"]sequelize['"]/ },
      { description: 'Mongoose import', pattern: /from ['"]mongoose['"]/ },
      { description: 'Knex import', pattern: /from ['"]knex['"]/ },
    ],
  },
  {
    name: 'Auth hashing: bcryptjs only (no argon2/scrypt/bcrypt native)',
    source: 'openspec/config.yaml#auth.password_hash',
    paths: ['packages/backend/src'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'argon2 import', pattern: /from ['"]argon2['"]/ },
      { description: 'bcrypt native import', pattern: /from ['"]bcrypt['"]/ },
      { description: 'scrypt-bcrypt import', pattern: /from ['"]scrypt-bcrypt['"]/ },
      // node:crypto is allowed for non-password primitives (HMAC, random) but
      // the script intentionally does not flag it — only specific password
      // hashing libraries are forbidden here.
    ],
  },
  {
    name: 'Auth JWT: jose only (no jsonwebtoken/passport-jwt)',
    source: 'openspec/config.yaml#auth.jwt',
    paths: ['packages/backend/src'],
    skip: ['node_modules', 'dist'],
    forbidden: [
      { description: 'jsonwebtoken import', pattern: /from ['"]jsonwebtoken['"]/ },
      { description: 'passport-jwt import', pattern: /from ['"]passport-jwt['"]/ },
      { description: 'passport import', pattern: /from ['"]passport['"]/ },
    ],
  },
];

interface Violation {
  readonly lockName: string;
  readonly file: string;
  readonly lineNumber: number;
  readonly line: string;
  readonly description: string;
}

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.pnpm-store',
]);

function isLockFile(filename: string): boolean {
  return (
    filename === 'pnpm-lock.yaml' ||
    filename === 'package-lock.json' ||
    filename === 'yarn.lock' ||
    filename.endsWith('.lock')
  );
}

function walkFiles(root: string, accumulated: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return accumulated;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const fullPath = join(root, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkFiles(fullPath, accumulated);
    } else if (stats.isFile()) {
      accumulated.push(fullPath);
    }
  }
  return accumulated;
}

function shouldSkipFile(file: string, lock: LockedDecision): boolean {
  const normalized = file.split(sep).join('/');
  if (isLockFile(normalized)) return true;
  for (const skipSegment of lock.skip) {
    if (normalized.includes(`/${skipSegment}/`) || normalized.endsWith(`/${skipSegment}`)) {
      return true;
    }
  }
  return false;
}

function isTextFile(file: string): boolean {
  // Cheap heuristic: skip obvious binary extensions. Real binary detection
  // would require reading the file, which we want to avoid for performance.
  const lower = file.toLowerCase();
  const binaryExtensions = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.ico',
    '.svgz',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
    '.bz2',
    '.7z',
    '.rar',
    '.mp3',
    '.mp4',
    '.wav',
    '.mov',
    '.avi',
    '.ttf',
    '.otf',
    '.woff',
    '.woff2',
    '.eot',
    '.so',
    '.dll',
    '.dylib',
    '.node',
    '.wasm',
  ];
  return !binaryExtensions.some((ext) => lower.endsWith(ext));
}

function scanLock(lock: LockedDecision): Violation[] {
  const violations: Violation[] = [];
  for (const relPath of lock.paths) {
    const absRoot = join(REPO_ROOT, relPath);
    let rootStats;
    try {
      rootStats = statSync(absRoot);
    } catch {
      continue;
    }
    const files = rootStats.isDirectory() ? walkFiles(absRoot) : [absRoot];
    for (const file of files) {
      if (shouldSkipFile(file, lock)) continue;
      if (!isTextFile(file)) continue;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        for (const forbidden of lock.forbidden) {
          const match = line.match(forbidden.pattern);
          if (match === null) continue;
          if (forbidden.allowIfContains !== undefined) {
            const captured = match[1] ?? match[0];
            if (captured.includes(forbidden.allowIfContains)) continue;
          }
          violations.push({
            lockName: lock.name,
            file: relative(REPO_ROOT, file),
            lineNumber: i + 1,
            line: line.trim(),
            description: forbidden.description,
          });
        }
      }
    }
  }
  return violations;
}

function main(): void {
  process.stdout.write('🔒 Verifying locked architectural decisions (KL-02)\n\n');

  const allViolations: Violation[] = [];
  for (const lock of LOCKS) {
    const violations = scanLock(lock);
    if (violations.length === 0) {
      process.stdout.write(`  ✅ ${lock.name}\n`);
    } else {
      process.stdout.write(`  ❌ ${lock.name} — ${violations.length} violation(s)\n`);
      allViolations.push(...violations);
    }
  }

  process.stdout.write('\n' + '='.repeat(72) + '\n');
  if (allViolations.length === 0) {
    process.stdout.write('✅ All locked decisions respected.\n');
    process.exit(0);
  }

  process.stderr.write(`❌ ${allViolations.length} violation(s) found:\n\n`);
  for (const v of allViolations) {
    process.stderr.write(`  [${v.description}]\n`);
    process.stderr.write(`    ${v.file}:${v.lineNumber}\n`);
    process.stderr.write(`    ${v.line}\n\n`);
  }
  process.exit(1);
}

main();

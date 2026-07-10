#!/usr/bin/env npx tsx
/**
 * Scan the repository for hardcoded secrets (KL-03).
 *
 * Walks every text file outside ignored directories and matches a curated
 * list of secret patterns (AWS, GitHub, Stripe, Slack, JWT, generic
 * high-entropy assignments, private keys, embedded credentials in URLs).
 * Findings are reported with file:line and a redacted preview.
 *
 * Excluded directories: node_modules, .git, dist, build, coverage,
 *                       playwright-report, .pnpm-store, .atl, .pi-subagents.
 * Excluded files:     lock files, .env.example (contains placeholder values),
 *                     test fixtures (*.test.ts, *.spec.ts, __tests__/**).
 *
 * Usage:
 *   cd packages/backend && pnpm exec tsx ../../scripts/check-no-secrets.ts
 *
 * Exit codes:
 *   0  no secrets found
 *   1  at least one potential secret detected
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SCRIPT_DIR = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const REPO_ROOT = join(SCRIPT_DIR, '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  '.pnpm-store',
  '.atl',
  '.pi-subagents',
  '.vite',
  '.cache',
  'cdk.out',
]);

const IGNORED_FILE_NAMES = new Set([
  '.env.example',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
]);

interface SecretPattern {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const PATTERNS: readonly SecretPattern[] = [
  {
    id: 'aws-access-key',
    description: 'AWS access key ID (AKIA/ASIA prefix + 16 chars)',
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/,
  },
  {
    id: 'aws-secret-in-env',
    description: 'AWS secret access key assignment',
    pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
  },
  {
    id: 'github-pat',
    description: 'GitHub personal access token (ghp_/gho_/ghu_/ghs_/ghr_)',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/,
  },
  {
    id: 'github-fine-grained-pat',
    description: 'GitHub fine-grained personal access token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
  },
  {
    id: 'stripe-live-key',
    description: 'Stripe live secret/publishable key',
    pattern: /\b((?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack token (xoxb/xoxp/xoxa/xoxr/xoxs)',
    pattern: /\b(xox[bpars]-[A-Za-z0-9-]{10,})\b/,
  },
  {
    id: 'jwt-token',
    description: 'JSON Web Token (three base64url segments)',
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
  },
  {
    id: 'private-key-block',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    id: 'generic-high-entropy-assignment',
    description: 'Generic high-entropy secret/password/token assignment',
    // Captures:  name = "value"  |  name: "value"  |  name = 'value'
    // Requires the value to look like a real secret (>=20 chars, mixed classes).
    pattern:
      /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]([A-Za-z0-9_\-+/=]{20,})['"]/i,
  },
  {
    id: 'embedded-db-credentials',
    description: 'Credentials embedded in a connection string',
    // postgres://user:pass@host  or  mongodb://user:pass@host
    // Captures only when user AND password look non-trivial.
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:'"<>]+:([^\s:'"<>@]{8,})@[^\s'"<>]+/i,
  },
];

interface Finding {
  readonly id: string;
  readonly description: string;
  readonly file: string;
  readonly lineNumber: number;
  readonly line: string;
  readonly preview: string;
}

const BINARY_EXTENSIONS = new Set([
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
  '.class',
  '.jar',
  '.parquet',
  '.arrow',
  '.feather',
]);

function isTestFile(file: string): boolean {
  const lower = file.toLowerCase();
  if (
    lower.includes('/__tests__/') ||
    lower.includes('/__fixtures__/') ||
    lower.includes('/__mocks__/')
  ) {
    return true;
  }
  if (lower.endsWith('.test.ts') || lower.endsWith('.test.js')) return true;
  if (lower.endsWith('.spec.ts') || lower.endsWith('.spec.js')) return true;
  return false;
}

function isLikelyBinary(file: string): boolean {
  const idx = file.lastIndexOf('.');
  if (idx === -1) return false;
  return BINARY_EXTENSIONS.has(file.slice(idx).toLowerCase());
}

function walk(root: string, accumulated: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return accumulated;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const fullPath = join(root, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(fullPath, accumulated);
    } else if (stats.isFile()) {
      accumulated.push(fullPath);
    }
  }
  return accumulated;
}

function redact(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

/**
 * Heuristics to reject obvious placeholders that matched a heuristic
 * pattern but are NOT real credentials. Each helper returns true when
 * the supplied capture looks like a non-secret placeholder value.
 */
function isPlaceholderValue(value: string): boolean {
  const v = value.toLowerCase();
  if (v.length === 0) return true;
  // Common placeholder shapes.
  if (/^change[-_]?me[-_]?on[-_]?first[-_]?deploy$/.test(v)) return true;
  if (/^change[-_]?me$/.test(v)) return true;
  if (/^placeholder$/.test(v)) return true;
  if (/^example$/.test(v)) return true;
  if (/^sample$/.test(v)) return true;
  if (/^<.+>$/.test(v)) return true;
  if (/^\$\{.+\}$/.test(v)) return true;
  if (/^your[-_]?api[-_]?key$/.test(v)) return true;
  // `xxx...` or `***...` is documentation noise.
  if (/^[xX*]+$/.test(v)) return true;
  // All-lowercase dictionary words like `changeme-on-first-deploy` with no
  // digits are not high-entropy — they are placeholder prose.
  if (v === v.replace(/[^a-z]/g, '') && v.split('-').every((w) => /^[a-z]+$/.test(w))) {
    return true;
  }
  return false;
}

function looksLikeTemplateLiteral(value: string): boolean {
  return /\$\{[^}]+\}/.test(value);
}

function isInConnectionStringTemplate(line: string): boolean {
  // Heuristic: lines that build a connection string via template literal
  // with `username` / `password` placeholders (no hardcoded secret).
  return /`(?:postgres|mysql|mongodb)(?:sql)?:\/\/\$\{[^}]+\}:\$\{[^}]+\}@\$\{[^}]+\}/.test(line);
}

function scanFile(file: string): Finding[] {
  const findings: Finding[] = [];
  const baseName = file.split(sep).pop() ?? '';
  if (IGNORED_FILE_NAMES.has(baseName)) return findings;
  if (isTestFile(file)) return findings;
  if (isLikelyBinary(file)) return findings;

  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return findings;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const pat of PATTERNS) {
      const match = line.match(pat.pattern);
      if (match === null) continue;
      const captured = match[1] ?? match[0];

      // Skip the high-entropy generic-assignment rule when the value is
      // clearly a documented placeholder (e.g. `change-me-on-first-deploy`).
      if (pat.id === 'generic-high-entropy-assignment' && isPlaceholderValue(captured)) {
        continue;
      }
      // Skip the embedded-credentials rule when the connection string is
      // being built via template literals (the password is fetched at
      // runtime from Secrets Manager, not hardcoded in source).
      if (pat.id === 'embedded-db-credentials') {
        if (looksLikeTemplateLiteral(captured) || isInConnectionStringTemplate(line)) {
          continue;
        }
      }

      findings.push({
        id: pat.id,
        description: pat.description,
        file: relative(REPO_ROOT, file),
        lineNumber: i + 1,
        line: line.trim(),
        preview: redact(captured),
      });
    }
  }
  return findings;
}

function main(): void {
  process.stdout.write('🔍 Scanning repository for hardcoded secrets (KL-03)\n');
  process.stdout.write(`   Root: ${REPO_ROOT}\n\n`);

  const files = walk(REPO_ROOT);
  process.stdout.write(`   Scanned ${files.length} files.\n\n`);

  const allFindings: Finding[] = [];
  for (const file of files) {
    const findings = scanFile(file);
    allFindings.push(...findings);
  }

  process.stdout.write('='.repeat(72) + '\n');
  if (allFindings.length === 0) {
    process.stdout.write('✅ No hardcoded secrets detected.\n');
    process.exit(0);
  }

  process.stderr.write(`❌ ${allFindings.length} potential secret(s) found:\n\n`);
  for (const f of allFindings) {
    process.stderr.write(`  [${f.id}] ${f.description}\n`);
    process.stderr.write(`    ${f.file}:${f.lineNumber}\n`);
    process.stderr.write(`    preview: ${f.preview}\n`);
    process.stderr.write(`    ${f.line}\n\n`);
  }
  process.exit(1);
}

main();

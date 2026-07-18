#!/usr/bin/env npx tsx
/**
 * Verify Drizzle migrations are strictly additive (KL-05).
 *
 * Per proposal §11.3 rollback contract, every migration file under
 * packages/backend/drizzle/ MUST be additive — no DROP COLUMN,
 * no DROP TABLE, no TRUNCATE, no ALTER COLUMN that changes a column type
 * (ALTER COLUMN ... SET DEFAULT / SET NOT NULL / DROP NOT NULL are allowed
 * because they don't change stored data shape; only TYPE changes are forbidden).
 *
 * Drizzle generates flat .sql files directly under drizzle/ (not subfolders),
 * so this script scans *.sql files in that directory directly.
 *
 * Usage:
 *   cd packages/backend && pnpm exec tsx ../../scripts/verify-additive-migrations.ts
 *
 * Exit codes:
 *   0  all migrations are additive
 *   1  at least one destructive / type-changing statement found
 *   2  no .sql files found under packages/backend/drizzle
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCRIPT_DIR = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const REPO_ROOT = join(SCRIPT_DIR, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/backend/drizzle');

interface DestructiveRule {
  readonly id: string;
  readonly description: string;
  /**
   * Regex applied line-by-line. When a `forbiddenColumnIndex` capture group is
   * present and non-empty, the rule also accepts lines where the captured
   * token is allowed (used for COMMENT/EXPLAIN contexts).
   */
  readonly pattern: RegExp;
}

interface Finding {
  readonly ruleId: string;
  readonly description: string;
  readonly file: string;
  readonly lineNumber: number;
  readonly line: string;
}

const RULES: readonly DestructiveRule[] = [
  {
    id: 'drop-column',
    description: 'DROP COLUMN removes data; forbidden by additive contract',
    // Matches: DROP COLUMN foo,  ALTER TABLE x DROP COLUMN y,  ALTER TABLE x DROP COLUMN y CASCADE
    pattern: /\bDROP\s+COLUMN\b/i,
  },
  {
    id: 'drop-table',
    description: 'DROP TABLE removes data; forbidden by additive contract',
    pattern: /\bDROP\s+TABLE\b/i,
  },
  {
    id: 'truncate',
    description: 'TRUNCATE deletes all rows; forbidden by additive contract',
    pattern: /\bTRUNCATE\b/i,
  },
  {
    id: 'alter-column-type',
    description: 'ALTER COLUMN ... TYPE changes the column type; forbidden',
    // Matches: ALTER COLUMN x TYPE ...,  ALTER COLUMN x SET DATA TYPE ...
    // Captures the TYPE keyword (group 1) so we can disambiguate from
    // SET DEFAULT / SET NOT NULL / DROP NOT NULL which DO NOT change type.
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+TYPE|TYPE)\b/i,
  },
  {
    id: 'alter-table-drop',
    description: 'ALTER TABLE ... DROP (column / constraint) is destructive',
    // Matches: ALTER TABLE x DROP COLUMN y  /  ALTER TABLE x DROP CONSTRAINT y
    // The DROP COLUMN case is already caught by rule "drop-column" but we
    // flag DROP CONSTRAINT here too because dropping a CHECK or FK is a
    // destructive schema change that breaks invariants.
    pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\s+(?!NOT\s+DEFAULT|NOT\s+NULL)\b/i,
  },
];

function dirExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List .sql migration files directly under drizzle/ (Drizzle generates flat files,
 * not subfolders like Prisma migrations did).
 */
function listMigrationFiles(root: string): string[] {
  // Numeric-aware lexicographic sort: Drizzle filenames are zero-padded
  // (0000_…, 0001_…) so string-sort matches numeric order up to 9999 entries.
  // For 5+ digit indices a natural-order comparator would be needed, but
  // 10k migrations is not a realistic horizon.
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.sql') && statSync(join(root, entry)).isFile())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function stripSqlComment(line: string): string {
  // Naive line-level comment stripping: anything from "--" to end-of-line is
  // a comment in PostgreSQL. This avoids false positives on lines like
  // `-- no DROP COLUMN here`.
  const idx = line.indexOf('--');
  return idx === -1 ? line : line.slice(0, idx);
}

function stripBlockComments(sql: string): string {
  // Remove /* ... */ blocks (non-greedy, multiline).
  return sql.replace(/\/\*[\s\S]*?\*\//g, '');
}

function scanMigration(file: string): Finding[] {
  const findings: Finding[] = [];
  const raw = readFileSync(file, 'utf8');
  // Strip block comments first so /* DROP COLUMN */ notes don't trip the rules.
  const cleaned = stripBlockComments(raw);
  const lines = cleaned.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i] ?? '';
    const code = stripSqlComment(original).trim();
    if (code.length === 0) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(code)) {
        findings.push({
          ruleId: rule.id,
          description: rule.description,
          file: relative(REPO_ROOT, file),
          lineNumber: i + 1,
          line: original.trim(),
        });
      }
    }
  }
  return findings;
}

function main(): void {
  process.stdout.write('🗃️  Verifying Drizzle migrations are additive (KL-05)\n\n');

  if (!dirExists(MIGRATIONS_DIR)) {
    process.stderr.write(`ERROR: migrations directory not found: ${MIGRATIONS_DIR}\n`);
    process.exit(2);
  }

  const migrationFiles = listMigrationFiles(MIGRATIONS_DIR);
  process.stdout.write(`   Directory: ${relative(REPO_ROOT, MIGRATIONS_DIR)}\n`);
  process.stdout.write(`   Found ${migrationFiles.length} migration file(s).\n\n`);

  const allFindings: Finding[] = [];
  const filesChecked: string[] = [];
  for (const sqlFileName of migrationFiles) {
    const file = join(MIGRATIONS_DIR, sqlFileName);
    filesChecked.push(relative(REPO_ROOT, file));
    const findings = scanMigration(file);
    if (findings.length === 0) {
      process.stdout.write(`  ✅ ${sqlFileName}\n`);
    } else {
      process.stdout.write(`  ❌ ${sqlFileName} — ${findings.length} violation(s)\n`);
      allFindings.push(...findings);
    }
  }

  process.stdout.write('\n' + '='.repeat(72) + '\n');
  if (filesChecked.length === 0) {
    process.stderr.write('ERROR: no .sql files found under packages/backend/drizzle.\n');
    process.exit(2);
  }

  if (allFindings.length === 0) {
    process.stdout.write(`✅ All ${filesChecked.length} migration(s) are additive.\n`);
    process.exit(0);
  }

  process.stderr.write(
    `❌ ${allFindings.length} destructive statement(s) in ${filesChecked.length} migration(s):\n\n`,
  );
  for (const f of allFindings) {
    process.stderr.write(`  [${f.ruleId}] ${f.description}\n`);
    process.stderr.write(`    ${f.file}:${f.lineNumber}\n`);
    process.stderr.write(`    ${f.line}\n\n`);
  }
  process.exit(1);
}

main();

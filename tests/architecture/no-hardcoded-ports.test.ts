/**
 * Hardcoded-port guard for docker-compose.dev.yml (PR 5).
 *
 * Locks the contract that EVERY port mapping in docker-compose.dev.yml
 * is interpolated from an env var. The user explicitly mandated:
 *   NEVER hardcode a port, URL, or name. If you find yourself typing
 *   a number, stop and add a var.
 *
 * Part A: pattern search (CI grep equivalent).
 * Part B: forbidden literal guard (per-port assertions).
 * Part C: negative control (proves the guard is real).
 * Part D: Vite/host corroboration.
 * Part E: dev-server port resolution contract.
 * Part F: .env.dev.example corroboration.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const COMPOSE_FILE = resolve(ROOT, 'docker-compose.dev.yml');
const ENV_FILE = resolve(ROOT, '.env.dev.example');

function grepFile(file: string, pattern: string): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('grep', ['-nE', pattern, file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return { exitCode: 1, stdout: '' };
    throw err;
  }
}

// Static regexes - match `<port>:<port>` not adjacent to other digits.
// Pre-compiled to keep the assertion site readable.
const NOT_DIGIT = '(?:^|[^0-9])';
const NOT_DIGIT_END = '(?:[^0-9]|$)';

const PORT_MAPPING_PAIRS: ReadonlyArray<{ literal: string; pattern: RegExp }> = [
  { literal: '3001:3001', pattern: new RegExp(NOT_DIGIT + '3001:3001' + NOT_DIGIT_END) },
  { literal: '5173:5173', pattern: new RegExp(NOT_DIGIT + '5173:5173' + NOT_DIGIT_END) },
  { literal: '5173:80', pattern: new RegExp(NOT_DIGIT + '5173:80' + NOT_DIGIT_END) },
  { literal: '4566:4566', pattern: new RegExp(NOT_DIGIT + '4566:4566' + NOT_DIGIT_END) },
  { literal: '5432:5432', pattern: new RegExp(NOT_DIGIT + '5432:5432' + NOT_DIGIT_END) },
  { literal: '80:80', pattern: new RegExp(NOT_DIGIT + '80:80' + NOT_DIGIT_END) },
];

function findLiteralPortMappings(text: string): string[] {
  const offenders: string[] = [];
  const lines2 = text.split('\n');
  for (let i = 0; i < lines2.length; i++) {
    const raw = lines2[i] ?? '';
    const commentStart = raw.indexOf(' #');
    const stripped = commentStart >= 0 ? raw.slice(0, commentStart) : raw;
    for (const pair of PORT_MAPPING_PAIRS) {
      if (pair.pattern.test(stripped)) {
        offenders.push(`line ${i + 1}: ${raw.trim()}`);
        break;
      }
    }
  }
  return offenders;
}

describe('Part A - pattern search (PR 5)', () => {
  it('does NOT contain any literal port mapping (e.g. 3001:3001)', () => {
    const pattern = 'ports:\\s*["\'\\047]?[0-9]{2,5}:[0-9]{2,5}';
    const { exitCode, stdout } = grepFile(COMPOSE_FILE, pattern);
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
  });
});

describe('Part B - forbidden literal guard (PR 5)', () => {
  it('no literal `3001:3001`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('3001:3001'));
    expect(offenders).toEqual([]);
  });
  it('no literal `5173:5173`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('5173:5173'));
    expect(offenders).toEqual([]);
  });
  it('no literal `5173:80`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('5173:80'));
    expect(offenders).toEqual([]);
  });
  it('no literal `4566:4566`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('4566:4566'));
    expect(offenders).toEqual([]);
  });
  it('no literal `5432:5432`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('5432:5432'));
    expect(offenders).toEqual([]);
  });
  it('no literal `80:80`', () => {
    const text = readFileSync(COMPOSE_FILE, 'utf8');
    const offenders = findLiteralPortMappings(text).filter((l) => l.includes('80:80'));
    expect(offenders).toEqual([]);
  });
});

describe('Part C - negative control (proves the guard is real)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'no-hardcoded-ports-'));
  const badFile = join(tmpDir, '_tmp-bad.yml');
  const goodFile = join(tmpDir, '_tmp-good.yml');

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bad fixture triggers the guard - proves it is real', () => {
    // Put the literal on the SAME line as `ports:` so grep -nE can match.
    // (grep works line-by-line; a multi-line YAML list with the literal
    // on a separate line would not be caught by the regex.)
    const badContents = [
      '# synthetic negative-control fixture',
      'services:',
      '  canary:',
      '    image: nginx:1.27-alpine',
      "    ports: '3001:3001'",
      "    ports2: '5173:80'",
      '    container_name: ceiba-canary',
    ].join('\n');
    writeFileSync(badFile, badContents);
    expect(existsSync(badFile)).toBe(true);

    const { exitCode, stdout } = grepFile(badFile, 'ports:\\s*["\'\\047]?[0-9]{2,5}:[0-9]{2,5}');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('3001:3001');

    const offenders = findLiteralPortMappings(badContents);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.join('\n')).toContain('3001:3001');
  });

  it('good fixture does NOT trigger the guard', () => {
    // Same shape - the env-var interpolation is on the ports line.
    const goodContents = [
      '# synthetic good fixture',
      'services:',
      '  canary:',
      '    image: nginx:1.27-alpine',
      "    ports: '${BACKEND_PORT}:${BACKEND_DOCKER_PORT}'",
      '    container_name: ${BACKEND_CONTAINER_NAME}',
    ].join('\n');
    writeFileSync(goodFile, goodContents);
    expect(existsSync(goodFile)).toBe(true);

    const { exitCode, stdout } = grepFile(goodFile, 'ports:\\s*["\'\\047]?[0-9]{2,5}:[0-9]{2,5}');
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');

    const offenders = findLiteralPortMappings(goodContents);
    expect(offenders).toEqual([]);
  });
});

describe('Part D - Vite/host corroboration', () => {
  it('packages/frontend/vite.config.ts reads port from FRONTEND_PORT', () => {
    const viteConfig = resolve(ROOT, 'packages/frontend/vite.config.ts');
    const text = readFileSync(viteConfig, 'utf8');
    expect(text).not.toMatch(/port:\s*5173\b/);
    expect(text).toMatch(/FRONTEND_PORT/);
  });
});

describe('Part E - dev-server port resolution contract', () => {
  it('DEFAULT_PORT=3001 is acceptable because resolvePort consults process.env.PORT', () => {
    const devServer = resolve(ROOT, 'scripts/dev-server.ts');
    const text = readFileSync(devServer, 'utf8');
    expect(text).toMatch(/DEFAULT_PORT\s*=\s*3001/);
    expect(text).toMatch(/process\.env\.PORT/);
    expect(text).toMatch(/function\s+resolvePort/);
  });
});

describe('Part F - .env.dev.example corroboration', () => {
  it('declares every port-relevant env var that compose interpolates', () => {
    const text = readFileSync(ENV_FILE, 'utf8');
    const requiredVars = ['POSTGRES_PORT', 'FRONTEND_PORT'];
    for (const v of requiredVars) {
      // Use indexOf instead of regex with dynamic input (lint rule).
      const linePresent = text.split('\n').some((l) => l.trim().startsWith(v + '='));
      // Throw with a descriptive message BEFORE the assertion so the failing
      // var name is visible; vitest/valid-expect forbids a 2nd `expect` arg.
      if (!linePresent) {
        throw new Error(`${v} not declared in .env.dev.example`);
      }
      expect(linePresent).toBe(true);
    }
  });
});

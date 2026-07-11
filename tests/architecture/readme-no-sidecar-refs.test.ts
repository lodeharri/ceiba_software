/**
 * README.md no sidecar refs + Local development section (Task 7.2; PR 3 — REQ-DOC-2).
 *
 * Locks the contract that the README's "Local development" section:
 *   - contains a relative link to `docs/LOCAL-DEV.md` (REQ-DOC-2 scenario 1),
 *   - does NOT mention any of the removed sidecar tokens
 *     (`deployer`, `s3-proxy`, `shared-data`, `/shared/.api-url`,
 *     `LOCALSTACK_BIND_HOST`, `API_GATEWAY_HOST_EXTERNAL`,
 *     `AWS_ENDPOINT_URL_S3`).
 *
 * Note: the README is allowed to mention LocalStack / postgres / Vite in
 * other sections (those are part of the current architecture). Only the
 * removed-sidecar terms are forbidden.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const README_FILE = resolve(ROOT, 'README.md');

const SIDECAR_TOKENS = [
  'deployer',
  's3-proxy',
  'shared-data',
  '/shared/.api-url',
  'LOCALSTACK_BIND_HOST',
  'API_GATEWAY_HOST_EXTERNAL',
  'AWS_ENDPOINT_URL_S3',
];

function loadReadme(): string {
  expect(existsSync(README_FILE)).toBe(true);
  return readFileSync(README_FILE, 'utf8');
}

function extractLocalDevSection(text: string): string {
  // Find the "## Local development" section (allow variations in casing).
  // Use `\Z` (end of string) for the terminal anchor; `$` in multiline mode
  // matches end-of-line which would stop the match right after the heading.
  const match = text.match(/^##\s+Local development[\s\S]*?(?=^##\s|Z)/im);
  return match ? match[0] : '';
}

describe('README.md — REQ-DOC-2 (no sidecar refs, links to docs/LOCAL-DEV.md)', () => {
  it('README.md exists', () => {
    expect(existsSync(README_FILE)).toBe(true);
  });

  it('the README does NOT mention any sidecar token (REQ-DOC-2 scenario 2)', () => {
    const text = loadReadme();
    for (const token of SIDECAR_TOKENS) {
      expect(text).not.toContain(token);
    }
  });

  it('the "Local development" section links to docs/LOCAL-DEV.md (relative)', () => {
    const text = loadReadme();
    const section = extractLocalDevSection(text);
    expect(section).toMatch(/docs\/LOCAL-DEV\.md/);
  });

  it('the "Local development" section mentions `pnpm dev`', () => {
    const text = loadReadme();
    const section = extractLocalDevSection(text);
    expect(section).toMatch(/pnpm dev\b/);
  });
});

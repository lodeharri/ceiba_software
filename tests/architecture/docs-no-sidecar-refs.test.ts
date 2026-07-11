/**
 * `docs/LOCAL-DEV.md` no sidecar refs (Task 7.1; PR 3 — REQ-DOC-1, REQ-DOC-4).
 *
 * Locks the contract that the rewritten `docs/LOCAL-DEV.md` does NOT mention
 * any of the removed sidecar tokens (`deployer`, `s3-proxy`, `shared-data`,
 * `/shared/.api-url`, `LOCALSTACK_BIND_HOST`, `API_GATEWAY_HOST_EXTERNAL`,
 * `AWS_ENDPOINT_URL_S3`).
 *
 * Also asserts the doc is ≤ 250 lines (REQ-DOC-1 NFR-1) and that the
 * Troubleshooting section addresses the five known failure modes (REQ-DOC-4
 * scenario 1): stale LocalStack, stale Vite cache, missing
 * `VITE_API_BASE_URL`, port collisions, DB not ready. Plus a "reset" path
 * (REQ-DOC-4 scenario 2).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DOCS_FILE = resolve(ROOT, 'docs/LOCAL-DEV.md');

const SIDECAR_TOKENS = [
  'deployer',
  's3-proxy',
  'shared-data',
  '/shared/.api-url',
  'LOCALSTACK_BIND_HOST',
  'API_GATEWAY_HOST_EXTERNAL',
  'AWS_ENDPOINT_URL_S3',
];

function loadDoc(): string {
  expect(existsSync(DOCS_FILE)).toBe(true);
  return readFileSync(DOCS_FILE, 'utf8');
}

describe('docs/LOCAL-DEV.md — REQ-DOC-1, REQ-DOC-4 (no sidecar refs, ≤ 250 lines, troubleshooting)', () => {
  it('docs/LOCAL-DEV.md exists', () => {
    expect(existsSync(DOCS_FILE)).toBe(true);
  });

  it('docs/LOCAL-DEV.md is ≤ 250 lines (NFR-1)', () => {
    const text = loadDoc();
    const lineCount = text.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(250);
  });

  it('does NOT contain any sidecar token (REQ-DOC-1 scenario 3)', () => {
    const text = loadDoc();
    for (const token of SIDECAR_TOKENS) {
      expect(text).not.toContain(token);
    }
  });

  it('leads with `pnpm dev` as the first-run command (REQ-DOC-1 scenario 1)', () => {
    const text = loadDoc();
    // The first fenced code block (or first 600 chars) should mention `pnpm dev`.
    const head = text.slice(0, 600);
    expect(head).toMatch(/pnpm dev\b/);
  });

  it('documents the four sub-commands (dev:up, dev:api, dev:web, dev)', () => {
    const text = loadDoc();
    for (const cmd of ['pnpm dev:up', 'pnpm dev:api', 'pnpm dev:web']) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain('pnpm dev');
  });

  it('Troubleshooting section addresses the 5 known failure modes (REQ-DOC-4 scenario 1)', () => {
    const text = loadDoc();
    // Locate the Troubleshooting section (case-insensitive heading match).
    const headingIdx = text.search(/^##\s+Troubleshooting/im);
    expect(headingIdx).toBeGreaterThanOrEqual(0);
    const tail = text.slice(headingIdx);
    // Required themes (each addressed with a fix).
    expect(tail).toMatch(/LocalStack/i);
    expect(tail).toMatch(/Vite/i);
    expect(tail).toMatch(/VITE_API_BASE_URL/);
    expect(tail).toMatch(/(port|3001|5173|5432)/i);
    expect(tail).toMatch(/DB|database|postgres|ready|wait/i);
  });

  it('Reset section mentions pnpm dev:reset (or docker compose down -v) (REQ-DOC-4 scenario 2)', () => {
    const text = loadDoc();
    expect(text).toMatch(/(pnpm dev:reset|docker compose down -v)/);
  });
});

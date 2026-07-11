/**
 * add-localstack-dev-env supersede marker (Task 8.1; PR 3 — REQ-DOC-3).
 *
 * Locks the contract that:
 *   - `openspec/changes/add-localstack-dev-env/proposal.md` contains the
 *     exact top-level section
 *     `## Status: superseded by replace-localstack-dev-server on 2026-07-10`,
 *   - the marker appears at or near the top of the file (within the first 5
 *     lines), and
 *   - the original proposal body is preserved (intact below the marker).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PROPOSAL = resolve(ROOT, 'openspec/changes/add-localstack-dev-env/proposal.md');

const REQUIRED_MARKER = '## Status: superseded by replace-localstack-dev-server on 2026-07-10';

function loadProposal(): string {
  expect(existsSync(PROPOSAL)).toBe(true);
  return readFileSync(PROPOSAL, 'utf8');
}

describe('add-localstack-dev-env/proposal.md — REQ-DOC-3 (supersede marker)', () => {
  it('proposal.md exists', () => {
    expect(existsSync(PROPOSAL)).toBe(true);
  });

  it('contains the exact supersede marker line', () => {
    const text = loadProposal();
    expect(text).toContain(REQUIRED_MARKER);
  });

  it('the marker appears at or near the top of the file (within first 5 lines)', () => {
    const text = loadProposal();
    const lines = text.split('\n').slice(0, 5);
    const foundInHead = lines.some((line) => line.includes(REQUIRED_MARKER));
    expect(foundInHead).toBe(true);
  });

  it('original proposal body is preserved (no body rewrite)', () => {
    const text = loadProposal();
    // The original proposal had this exact problem statement line.
    expect(text).toContain('# Proposal: add-localstack-dev-env');
    expect(text).toContain('## Problem');
    expect(text).toContain('## User Stories');
  });

  it('only ONE supersede marker line exists (no duplicates)', () => {
    const text = loadProposal();
    const occurrences = text.split(REQUIRED_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });
});

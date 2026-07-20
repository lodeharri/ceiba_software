import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = '/home/harri/development/projects/ceiba_software';
const DOMAIN_DIR = join(REPO_ROOT, 'packages/backend/src/products/domain');
const APPLICATION_DIR = join(REPO_ROOT, 'packages/backend/src/products/application');
const BLOCKED_SDKS = [
  '@google/generative-ai',
  '@google-cloud/vertexai',
  'openai',
  '@anthropic-ai/sdk',
  'voyageai',
  'ollama',
] as const;

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkTs(full);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) yield full;
  }
}

function hasImportOf(content: string, sdk: string): boolean {
  // Match: import ... from 'sdk' or import ... from "sdk"
  const pat = `from '${sdk}'`;
  const pat2 = `from "${sdk}"`;
  return content.includes(pat) || content.includes(pat2);
}

describe('Embedding layer discipline', () => {
  it('products/domain/ contains zero SDK imports', () => {
    const offenders: string[] = [];
    for (const file of walkTs(DOMAIN_DIR)) {
      const content = readFileSync(file, 'utf8');
      for (const sdk of BLOCKED_SDKS) {
        if (hasImportOf(content, sdk)) {
          offenders.push(`${relative(REPO_ROOT, file)} imports blocked SDK ${sdk}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('products/application/ contains zero SDK imports', () => {
    const offenders: string[] = [];
    for (const file of walkTs(APPLICATION_DIR)) {
      const content = readFileSync(file, 'utf8');
      for (const sdk of BLOCKED_SDKS) {
        if (hasImportOf(content, sdk)) {
          offenders.push(`${relative(REPO_ROOT, file)} imports blocked SDK ${sdk}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('products/domain/ contains zero process.env references', () => {
    const offenders: string[] = [];
    for (const file of walkTs(DOMAIN_DIR)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('process.env')) {
        offenders.push(
          `${relative(REPO_ROOT, file)} uses process.env (env access is infrastructure-only)`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('products/application/ contains zero process.env references', () => {
    const offenders: string[] = [];
    for (const file of walkTs(APPLICATION_DIR)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('process.env')) {
        offenders.push(
          `${relative(REPO_ROOT, file)} uses process.env (env access is infrastructure-only)`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

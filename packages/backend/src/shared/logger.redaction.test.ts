/**
 * RED fixture: assert apiKey and GEMINI_API_KEY are redacted in pino JSON output.
 * GREEN: add redact paths to createLogger().
 * TRIANGULATE: deeply nested keys, non-sensitive siblings.
 */

import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';
import { Writable } from 'node:stream';

describe('pino redaction for API keys', () => {
  it('redacts flat apiKey', () => {
    let captured = '';
    const dest = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured = chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: 'info' }, dest);
    logger.info({ apiKey: 'sk-gemini-secret-xyz' }, 'test');
    expect(captured).not.toContain('sk-gemini-secret-xyz');
    expect(captured).toContain('apiKey'); // key name preserved, value redacted
  });

  it('redacts flat GEMINI_API_KEY', () => {
    let captured = '';
    const dest = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured = chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: 'info' }, dest);
    logger.info({ GEMINI_API_KEY: 'sk-gemini-other-123' }, 'test');
    expect(captured).not.toContain('sk-gemini-other-123');
    expect(captured).toContain('GEMINI_API_KEY');
  });

  it('redacts nested apiKey', () => {
    let captured = '';
    const dest = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured = chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: 'info' }, dest);
    logger.info({ context: { embedder: { apiKey: 'sk-nested-secret' } } }, 'test');
    expect(captured).not.toContain('sk-nested-secret');
    expect(captured).toContain('embedder');
  });

  it('redacts nested GEMINI_API_KEY', () => {
    let captured = '';
    const dest = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured = chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: 'info' }, dest);
    logger.info({ nested: { GEMINI_API_KEY: 'sk-nested-gemini' } }, 'test');
    expect(captured).not.toContain('sk-nested-gemini');
    expect(captured).toContain('nested');
  });

  it('non-sensitive fields are unaffected', () => {
    let captured = '';
    const dest = new Writable({
      write(chunk: Buffer, _enc, cb) {
        captured = chunk.toString();
        cb();
      },
    });
    const logger = createLogger({ level: 'info' }, dest);
    logger.info({ provider: 'gemini', attempt: 1, latencyMs: 50 }, 'embedding call');
    expect(captured).toContain('gemini');
    expect(captured).toContain('"attempt":1');
    expect(captured).toContain('"latencyMs":50');
  });
});

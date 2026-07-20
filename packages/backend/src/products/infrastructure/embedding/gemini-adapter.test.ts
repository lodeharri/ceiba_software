/**
 * Tests for GeminiEmbeddingAdapter.
 * Uses httpClient + delayFn injection — no fake timers needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger as PinoLogger } from 'pino';
import { GeminiEmbeddingAdapter } from './gemini-adapter.js';
import { EmbeddingInputTooLongError } from '../../domain/errors/embedding-input-too-long.js';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';

type FakeResponse = { ok: boolean; status: number; body: unknown };

function makeHttpClient(responses: FakeResponse[]) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[idx++]!;
    return {
      ok: r.ok,
      status: r.status,
      async json() {
        return r.body;
      },
      async text() {
        return JSON.stringify(r.body);
      },
    };
  });
}

// Logger mock — typed as 'any' so we can access .mock.calls for assertions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubLogger: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => stubLogger),
};

function makeAdapter(httpClient: ReturnType<typeof makeHttpClient>) {
  return new GeminiEmbeddingAdapter({
    apiKey: 'sk-test',
    httpClient,
    logger: stubLogger as PinoLogger,
    delayFn: () => Promise.resolve(),
  });
}

describe('GeminiEmbeddingAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 2.5: Input > 8192 chars ─────────────────────────────────────────

  it('8193-char input throws EmbeddingInputTooLongError without HTTP call', async () => {
    const httpClient = makeHttpClient([{ ok: true, status: 200, body: {} }]);
    const adapter = makeAdapter(httpClient);

    const longInput = 'x'.repeat(8193);
    await expect(adapter.embed(longInput)).rejects.toThrow(EmbeddingInputTooLongError);
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('8192-char input succeeds (boundary)', async () => {
    const httpClient = makeHttpClient([
      {
        ok: true,
        status: 200,
        body: { embedding: { values: Array(768).fill(0.1) } },
      },
    ]);
    const adapter = makeAdapter(httpClient);

    const result = await adapter.embed('x'.repeat(8192));
    expect(result).toHaveLength(768);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  // ── Scenario 2.1: Happy path ─────────────────────────────────────────────────

  it('embed returns 768-dim vector on success', async () => {
    const httpClient = makeHttpClient([
      {
        ok: true,
        status: 200,
        body: { embedding: { values: Array(768).fill(0.42) } },
      },
    ]);
    const adapter = makeAdapter(httpClient);

    const result = await adapter.embed('laptop gaming');
    expect(result).toHaveLength(768);
    expect(result[0]).toBeCloseTo(0.42);
    expect(stubLogger.child).toHaveBeenCalledWith({ component: 'GeminiEmbeddingAdapter' });
  });

  // ── Scenario 2.3: First three 429s, fourth 200 → success after three retries ──

  it('first three 429s, fourth 200 → success after three retries', async () => {
    const httpClient = makeHttpClient([
      { ok: false, status: 429, body: {} },
      { ok: false, status: 429, body: {} },
      { ok: false, status: 429, body: {} },
      { ok: true, status: 200, body: { embedding: { values: Array(768).fill(0.5) } } },
    ]);
    const adapter = makeAdapter(httpClient);

    const result = await adapter.embed('test');

    expect(result).toHaveLength(768);
    expect(httpClient).toHaveBeenCalledTimes(4);
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', attempt: 1, outcome: 'retry' }),
      expect.any(String),
    );
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', attempt: 2, outcome: 'retry' }),
      expect.any(String),
    );
    expect(stubLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', attempt: 3, outcome: 'retry' }),
      expect.any(String),
    );
    expect(stubLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', attempt: 4, outcome: 'success' }),
      expect.any(String),
    );
  });

  // ── Scenario 2.4: All 4 attempts fail ─────────────────────────────────────

  it('4 consecutive 500s → throws EmbeddingProviderUnavailableError', async () => {
    const httpClient = makeHttpClient([
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
    ]);
    const adapter = makeAdapter(httpClient);

    await expect(adapter.embed('test')).rejects.toThrow(EmbeddingProviderUnavailableError);
    expect(httpClient).toHaveBeenCalledTimes(4);
    // exhausted is logged on attempt 4 (the 4th warn call)
    expect(stubLogger.warn).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ provider: 'gemini', attempt: 4, outcome: 'exhausted' }),
      expect.any(String),
    );
  });

  // ── Scenario 2.2: Batch embed ───────────────────────────────────────────────

  it('embedBatch calls in parallel and returns arrays in order', async () => {
    const httpClient = makeHttpClient([
      { ok: true, status: 200, body: { embedding: { values: Array(768).fill(0.1) } } },
      { ok: true, status: 200, body: { embedding: { values: Array(768).fill(0.2) } } },
      { ok: true, status: 200, body: { embedding: { values: Array(768).fill(0.3) } } },
    ]);
    const adapter = makeAdapter(httpClient);

    const results = await adapter.embedBatch(['text a', 'text b', 'text c']);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toHaveLength(768);
    }
    expect(httpClient).toHaveBeenCalledTimes(3);
  });

  // ── Scenario 2.6: API key never in logs ────────────────────────────────────

  it('success path: API key does not appear in any log call', async () => {
    const httpClient = makeHttpClient([
      {
        ok: true,
        status: 200,
        body: { embedding: { values: Array(768).fill(0.1) } },
      },
    ]);
    const adapter = new GeminiEmbeddingAdapter({
      apiKey: 'sk-gemini-secret-xyz',
      httpClient,
      logger: stubLogger,
      delayFn: () => Promise.resolve(),
    });

    await adapter.embed('test');

    const allLogCalls = [
      ...stubLogger.info.mock.calls,
      ...stubLogger.warn.mock.calls,
      ...stubLogger.error.mock.calls,
    ];
    for (const call of allLogCalls) {
      expect(JSON.stringify(call)).not.toContain('sk-gemini-secret-xyz');
    }
  });

  it('failure path: API key does not appear in any log call', async () => {
    const httpClient = makeHttpClient([
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
      { ok: false, status: 500, body: {} },
    ]);
    const adapter = new GeminiEmbeddingAdapter({
      apiKey: 'sk-gemini-secret-xyz',
      httpClient,
      logger: stubLogger,
      delayFn: () => Promise.resolve(),
    });

    await expect(adapter.embed('test')).rejects.toThrow();

    const allLogCalls = [
      ...stubLogger.info.mock.calls,
      ...stubLogger.warn.mock.calls,
      ...stubLogger.error.mock.calls,
    ];
    for (const call of allLogCalls) {
      expect(JSON.stringify(call)).not.toContain('sk-gemini-secret-xyz');
    }
  });

  // ── Body shape verification (API contract: model field + snake_case task_type) ─

  it('sends correct body shape: model field + task_type snake_case', async () => {
    const httpClient = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { embedding: { values: Array(768).fill(0.1) } };
      },
      async text() {
        return JSON.stringify({ embedding: { values: Array(768).fill(0.1) } });
      },
    });
    const adapter = makeAdapter(httpClient as ReturnType<typeof makeHttpClient>);
    await adapter.embed('test');

    const callArgs = httpClient.mock.calls[0] as [string, RequestInit?];
    const bodyStr = callArgs[1]?.body as string;
    expect(bodyStr).toBeDefined();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyStr!) as Record<string, unknown>;
    } catch {
      expect.fail('body is not valid JSON');
      return;
    }
    expect(body.model).toBe('models/gemini-embedding-001');
    expect(body.task_type).toBe('RETRIEVAL_DOCUMENT');
    expect(body).not.toHaveProperty('taskType');
    expect(body.content).toBeDefined();
    expect((body.content as Record<string, unknown>).parts).toBeDefined();
  });
});

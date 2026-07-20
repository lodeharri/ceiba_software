/**
 * RED fixture: assert SSM resolution, caching, local fallback, and error paths.
 * GREEN: implement resolveGeminiApiKey.
 *
 * Tests use vi.mock to control SSM client behavior without needing
 * to manipulate module-level IS_LOCAL state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({ send: mockSend })),
  GetParametersCommand: vi.fn().mockImplementation((params: { Names: string[] }) => ({
    input: params,
  })),
}));

// Top-level dynamic import so the module is fresh in each test
async function importResolver() {
  return import('./api-key-resolver.js');
}

describe('resolveGeminiApiKey', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({ ...logger, info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__ceibaEmbeddingApiKeyCache;
    vi.resetModules();
    // Clear process.env to a known clean state
    delete process.env['STAGE'];
    delete process.env['AWS_ENDPOINT_URL'];
    delete process.env['GEMINI_API_KEY'];
  });

  it('SSM path resolves key from SSM on first call', async () => {
    mockSend.mockResolvedValueOnce({
      Parameters: [{ Value: 'sk-ssm-key-123' }],
    });
    // Ensure non-local env
    process.env['STAGE'] = 'dev';
    process.env['AWS_ENDPOINT_URL'] = 'https://localstack:4566';

    const { resolveGeminiApiKey } = await importResolver();
    const key = await resolveGeminiApiKey(logger);
    expect(key).toBe('sk-ssm-key-123');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('SSM path caches on second call without SSM call', async () => {
    mockSend.mockResolvedValueOnce({
      Parameters: [{ Value: 'sk-ssm-key-456' }],
    });
    process.env['STAGE'] = 'dev';
    process.env['AWS_ENDPOINT_URL'] = 'https://localstack:4566';

    const { resolveGeminiApiKey } = await importResolver();
    await resolveGeminiApiKey(logger);
    await resolveGeminiApiKey(logger);
    expect(mockSend).toHaveBeenCalledTimes(1); // second call is cache hit
  });

  it('SSM path throws EmbeddingProviderUnavailableError on SSM failure', async () => {
    mockSend.mockRejectedValueOnce(new Error('Access Denied'));
    process.env['STAGE'] = 'dev';
    process.env['AWS_ENDPOINT_URL'] = 'https://localstack:4566';

    const { resolveGeminiApiKey } = await importResolver();
    await expect(resolveGeminiApiKey(logger)).rejects.toThrow(
      "Embedding provider 'gemini' is unavailable",
    );
  });

  it('local stage (STAGE=local) reads GEMINI_API_KEY without SSM call', async () => {
    process.env['STAGE'] = 'local';
    process.env['GEMINI_API_KEY'] = 'sk-local-key';

    const { resolveGeminiApiKey } = await importResolver();
    const key = await resolveGeminiApiKey(logger);
    expect(key).toBe('sk-local-key');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('local stage (no AWS_ENDPOINT_URL) reads GEMINI_API_KEY without SSM call', async () => {
    process.env['STAGE'] = 'dev';
    // AWS_ENDPOINT_URL is deleted in beforeEach
    process.env['GEMINI_API_KEY'] = 'sk-dev-env-key';

    const { resolveGeminiApiKey } = await importResolver();
    const key = await resolveGeminiApiKey(logger);
    expect(key).toBe('sk-dev-env-key');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('local stage throws when GEMINI_API_KEY is missing', async () => {
    process.env['STAGE'] = 'local';
    // GEMINI_API_KEY deleted in beforeEach

    const { resolveGeminiApiKey } = await importResolver();
    await expect(resolveGeminiApiKey(logger)).rejects.toThrow('Embedding provider');
    await expect(resolveGeminiApiKey(logger)).rejects.toThrow('missing-api-key');
  });
});

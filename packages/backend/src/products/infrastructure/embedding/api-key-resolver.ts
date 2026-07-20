/**
 * Gemini API key resolver — SSM Parameter Store (production) or local env (dev).
 *
 * Design: design.md §3 R4, Requirement 4 (spec.md).
 *
 * Resolution order:
 * 1. If STAGE=local or AWS_ENDPOINT_URL unset → read GEMINI_API_KEY from process.env
 * 2. Otherwise → fetch from SSM Parameter Store /ceiba/{STAGE}/gemini-api-key
 * 3. Cache result in globalThis for the Lambda cold-start lifetime
 *
 * Note: globalThis cache means SSM changes after Lambda warm-start do not apply
 * until the next cold-start. This is the same trade-off as the JWT secret pattern.
 */

import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { EmbeddingProviderUnavailableError } from '../../domain/errors/embedding-provider-unavailable.js';
import type { Logger as PinoLogger } from 'pino';

interface CacheEntry {
  value: string;
  stage: string;
}

interface GlobalWithApiKeyCache {
  __ceibaEmbeddingApiKeyCache?: CacheEntry;
}

const STAGE = process.env['STAGE'] ?? 'dev';
const IS_LOCAL = STAGE === 'local' || !process.env['AWS_ENDPOINT_URL'];

// Module-level SSM client singleton — keeps connection warm between invocations
const SSM_CLIENT = new SSMClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
});

export async function resolveGeminiApiKey(logger: PinoLogger): Promise<string> {
  // Local / dev-server bypass — read from env directly
  if (IS_LOCAL) {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) {
      throw new EmbeddingProviderUnavailableError('gemini', 'missing-api-key');
    }
    return key;
  }

  // globalThis cache (execution-environment lifetime)
  const g = globalThis as GlobalWithApiKeyCache;
  if (g.__ceibaEmbeddingApiKeyCache?.stage === STAGE) {
    logger.info({ provider: 'gemini', source: 'cache' }, 'Gemini API key resolved from cache');
    return g.__ceibaEmbeddingApiKeyCache.value;
  }

  const paramName = `/ceiba/${STAGE}/gemini-api-key`;
  const log = logger.child({ provider: 'gemini', ssmParam: paramName });

  try {
    const command = new GetParametersCommand({
      Names: [paramName],
      WithDecryption: true,
    });
    const result = await SSM_CLIENT.send(command);
    const param = result.Parameters?.[0];
    if (!param?.Value) {
      throw new EmbeddingProviderUnavailableError('gemini', 'ssm-param-not-found');
    }
    g.__ceibaEmbeddingApiKeyCache = { value: param.Value, stage: STAGE };
    log.info({ source: 'ssm' }, 'Gemini API key resolved from SSM');
    return param.Value;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error({ reason }, 'Failed to resolve Gemini API key from SSM');
    throw new EmbeddingProviderUnavailableError('gemini', 'ssm-fetch-failed');
  }
}

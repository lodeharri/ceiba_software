#!/usr/bin/env npx tsx
/**
 * Smoke Test: Cold Start Latency (RISK-W09)
 *
 * Hits a deployed dev URL after 30 minutes idle to verify
 * Lambda cold start p95 latency is under 3000ms.
 *
 * Usage: E2E_BASE_URL=https://your-api.dev.example.com npx tsx scripts/smoke-cold-start.ts
 */

import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const TARGET_P95_MS = 3000;
const SAMPLE_COUNT = 20;
const IDLE_WAIT_MS = 30 * 60 * 1000; // 30 minutes

interface LatencyResult {
  latencyMs: number;
  status: number;
  ok: boolean;
}

async function measureEndpoint(path: string): Promise<LatencyResult> {
  const start = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const latencyMs = performance.now() - start;
    return { latencyMs, status: response.status, ok: response.ok || response.status === 401 };
  } catch {
    const latencyMs = performance.now() - start;
    return { latencyMs, status: 0, ok: false };
  }
}

function calculateP95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[index];
}

async function runColdStartSmoke(): Promise<void> {
  console.info('🔍 Cold Start Smoke Test (RISK-W09)');
  console.info(`   Target p95: <${TARGET_P95_MS}ms`);
  console.info(`   Samples: ${SAMPLE_COUNT}`);
  console.info(`   Base URL: ${BASE_URL}`);

  // Optional: wait for idle period
  if (process.env.WAIT_FOR_IDLE === 'true') {
    console.info(`\n⏳ Waiting ${IDLE_WAIT_MS / 1000 / 60} minutes for cold start...`);
    await new Promise((resolve) => setTimeout(resolve, IDLE_WAIT_MS));
  }

  const endpoints = [
    '/api/v1/products', // products-lambda
    '/api/v1/auth/login', // auth-lambda
    '/api/v1/alerts', // alerts-lambda
  ];

  let allPassed = true;

  for (const endpoint of endpoints) {
    console.info(`\n📊 Testing ${endpoint}...`);
    const latencies: number[] = [];

    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const result = await measureEndpoint(endpoint);
      if (result.ok) {
        latencies.push(result.latencyMs);
        process.stdout.write('.');
      } else {
        process.stdout.write('F');
      }
      // Small delay between samples
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.info('');

    if (latencies.length === 0) {
      console.error(`   ❌ No successful requests`);
      allPassed = false;
      continue;
    }

    const p95 = calculateP95(latencies);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const max = Math.max(...latencies);

    console.info(
      `   Avg: ${avg.toFixed(0)}ms | p95: ${p95.toFixed(0)}ms | Max: ${max.toFixed(0)}ms`,
    );

    if (p95 > TARGET_P95_MS) {
      console.error(`   ❌ p95 exceeds target (${p95.toFixed(0)}ms > ${TARGET_P95_MS}ms)`);
      allPassed = false;
    } else {
      console.info(`   ✅ PASS`);
    }
  }

  console.info('\n' + '='.repeat(50));
  if (allPassed) {
    console.info('✅ All cold start tests passed');
    process.exit(0);
  } else {
    console.error('❌ Cold start smoke FAILED');
    process.exit(1);
  }
}

runColdStartSmoke().catch((error) => {
  console.error('❌ Smoke test error:', error);
  process.exit(1);
});

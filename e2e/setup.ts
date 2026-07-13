import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Playwright global setup — runs once before all E2E tests.
 *
 * Loads .env.dev from the workspace root so that credentials like
 * ADMIN_PASSWORD are available via process.env during test execution.
 * This eliminates the need for E2E-specific env var names and ensures
 * tests use the same credentials as local dev.
 */
export default async function globalSetup() {
  const envPath = resolve(process.cwd(), '.env.dev');
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  } else {
    throw new Error(
      `E2E setup: .env.dev not found at ${envPath}. Copy .env.dev.example to .env.dev before running E2E tests.`,
    );
  }
}

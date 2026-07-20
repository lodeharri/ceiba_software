/**
 * RED fixture: verify idempotent migration runs twice without error.
 * GREEN: create 0001_add_product_embedding.sql.
 * TRIANGULATE: verify indexdef matches HNSW + vector_cosine_ops.
 *
 * Requires DATABASE_URL env var. Skips if not set (CI without DB).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const DATABASE_URL = process.env['DATABASE_URL'];
const SKIP_REASON = 'DATABASE_URL not set — skipping integration test';

describe('0001_add_product_embedding idempotency', () => {
  beforeAll(() => {
    if (!DATABASE_URL) {
      console.warn(SKIP_REASON);
    }
  });

  it('migration is idempotent — runs twice without error', async () => {
    if (!DATABASE_URL) return; // skip

    // Apply migration
    const { exec } = await import('node:child_process');
    const run = (cmd: string) =>
      new Promise<void>((res, rej) => {
        exec(cmd, { env: { ...process.env, DATABASE_URL } }, (err, _stdout, stderr) => {
          if (err) rej(new Error(`${cmd}\n${stderr}`));
          else res();
        });
      });

    // First run: creates column + index
    await run(`pnpm --filter @mercadoexpress/backend db:migrate`);

    // Second run: idempotent — no error
    await run(`pnpm --filter @mercadoexpress/backend db:migrate`);

    // Verify column exists

    await expect(
      run(`psql "${DATABASE_URL}" -c "SELECT embedding FROM products LIMIT 1;"`),
    ).resolves.not.toThrow();
  });

  it('embedding column accepts NULL', async () => {
    if (!DATABASE_URL) return;

    const { exec } = await import('node:child_process');
    const run = (cmd: string) =>
      new Promise<string>((res, rej) => {
        exec(cmd, { env: { ...process.env, DATABASE_URL } }, (err, stdout) => {
          if (err) rej(new Error(`${cmd}: ${err.message}`));
          else res(stdout);
        });
      });

    // Insert with NULL embedding

    const out = await run(
      `psql "${DATABASE_URL}" -t -c "INSERT INTO products (sku, name, category_id, price, stock, stock_min, supplier, embedding) VALUES ('TEST-NULL', 'Test', gen_random_uuid(), 100, 0, 0, 'Test', NULL) RETURNING embedding;"`,
    );
    expect(out.trim()).toContain('NULL');
  });

  it('HNSW index uses vector_cosine_ops', async () => {
    if (!DATABASE_URL) return;

    const { exec } = await import('node:child_process');
    const run = (cmd: string) =>
      new Promise<string>((res, rej) => {
        exec(cmd, { env: { ...process.env, DATABASE_URL } }, (err, stdout) => {
          if (err) rej(new Error(`${cmd}: ${err.message}`));
          else res(stdout);
        });
      });

    const indexdef = await run(
      `psql "${DATABASE_URL}" -t -c "SELECT indexdef FROM pg_indexes WHERE indexname='products_embedding_hnsw';"`,
    );
    expect(indexdef).toContain('hnsw');
    expect(indexdef).toContain('vector_cosine_ops');
  });
});

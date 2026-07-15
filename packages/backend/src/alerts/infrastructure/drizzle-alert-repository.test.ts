import { describe, expect, it } from 'vitest';
import { DrizzleAlertRepository } from './drizzle-alert-repository.js';

function createDbStub(opts: { rows?: Array<Record<string, unknown>>; count?: number }) {
  const rows = opts.rows ?? [];
  const count = opts.count ?? 0;
  return {
    select: (projection?: Record<string, unknown>) => {
      const isCount = projection != null && 'count' in projection;
      const data = isCount ? [{ count }] : rows;
      const chain: Record<string, unknown> = {};
      chain['from'] = () => chain;
      chain['where'] = () => chain;
      chain['orderBy'] = () => chain;
      chain['limit'] = () => chain;
      chain['offset'] = () => chain;
      Object.defineProperty(chain, 'then', {
        value(onFulfilled: (v: unknown) => unknown) {
          return Promise.resolve(data).then(onFulfilled);
        },
      });
      return chain;
    },
  };
}

const ALERT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    productId: PRODUCT_ID,
    status: 'ACTIVA',
    type: 'STOCK_BAJO',
    resolvedAt: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('DrizzleAlertRepository (alerts BC — infrastructure)', () => {
  it('findById returns AlertProps when found', async () => {
    const rows = [alertRow()];
    const db = createDbStub({ rows, count: 1 });
    const repo = new DrizzleAlertRepository(db as never);
    const result = await repo.findById(ALERT_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(ALERT_ID);
    expect(result!.productId).toBe(PRODUCT_ID);
    expect(result!.status).toBe('ACTIVA');
  });

  it('findById returns null when not found', async () => {
    const db = createDbStub({ rows: [], count: 0 });
    const repo = new DrizzleAlertRepository(db as never);
    const result = await repo.findById('00000000-0000-4000-8000-000000000000');

    expect(result).toBeNull();
  });

  it('list returns items with pagination', async () => {
    const rows = [alertRow({ id: 'id-1' }), alertRow({ id: 'id-2', status: 'RESUELTA' })];
    const db = createDbStub({ rows, count: 2 });
    const repo = new DrizzleAlertRepository(db as never);
    const result = await repo.list({ page: 1, size: 20 });

    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(1);
    expect(result.size).toBe(20);
  });

  it('count returns the total number of alerts', async () => {
    const db = createDbStub({ rows: [], count: 5 });
    const repo = new DrizzleAlertRepository(db as never);
    const result = await repo.count({ status: 'ACTIVA' });

    expect(result).toBe(5);
  });
});

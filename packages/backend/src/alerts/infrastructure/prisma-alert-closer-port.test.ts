import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaAlertCloserPort } from './prisma-alert-closer-port.js';

function createTxStub() {
  let updateResult: Array<{ id: string }> = [];

  const queryRawMock = vi.fn(async () => updateResult);

  return {
    _setUpdateResult(rows: Array<{ id: string }>) {
      updateResult = rows;
    },
    _getQueryRawMock: () => queryRawMock,
    $queryRaw: queryRawMock,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('PrismaAlertCloserPort (alerts BC — infrastructure)', () => {
  let tx: ReturnType<typeof createTxStub>;
  let port: PrismaAlertCloserPort;

  beforeEach(() => {
    tx = createTxStub();
    port = new PrismaAlertCloserPort();
  });

  it('executes UPDATE with RETURNING id and WHERE status = ACTIVA', async () => {
    tx._setUpdateResult([{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }]);

    const result = await port.txCloseIfOpenAndAboveMin(tx, {
      productId: PRODUCT_ID,
      newStock: 15,
      stockMin: 10,
    });

    const mock = tx._getQueryRawMock();
    expect(mock).toHaveBeenCalledOnce();

    // Verify the SQL template contains RETURNING id and WHERE status = 'ACTIVA'
    const templateStr = String(mock.mock.calls[0]![0]);
    expect(templateStr).toContain('RETURNING id');
    expect(templateStr).toContain("status = 'ACTIVA'");

    expect(result).toEqual({ alertId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  });

  it('returns null when no active alert exists (idempotent no-op)', async () => {
    tx._setUpdateResult([]); // no rows returned

    const result = await port.txCloseIfOpenAndAboveMin(tx, {
      productId: PRODUCT_ID,
      newStock: 15,
      stockMin: 10,
    });

    expect(result).toBeNull();
  });

  it('is a no-op when newStock <= stockMin (does not execute SQL)', async () => {
    const result = await port.txCloseIfOpenAndAboveMin(tx, {
      productId: PRODUCT_ID,
      newStock: 5,
      stockMin: 10,
    });

    const mock = tx._getQueryRawMock();
    expect(mock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('closes alert when newStock > stockMin even if equals stockMin boundary', async () => {
    // newStock > stockMin means close
    tx._setUpdateResult([{ id: 'close-boundary' }]);

    const result = await port.txCloseIfOpenAndAboveMin(tx, {
      productId: PRODUCT_ID,
      newStock: 11,
      stockMin: 10,
    });

    expect(result).toEqual({ alertId: 'close-boundary' });
  });

  it('does NOT close when newStock equals stockMin exactly', async () => {
    const result = await port.txCloseIfOpenAndAboveMin(tx, {
      productId: PRODUCT_ID,
      newStock: 10,
      stockMin: 10,
    });

    const mock = tx._getQueryRawMock();
    expect(mock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

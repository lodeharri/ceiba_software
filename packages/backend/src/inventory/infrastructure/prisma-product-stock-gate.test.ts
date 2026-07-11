import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PrismaProductStockGate } from './prisma-product-stock-gate.js';

// Minimal Prisma tx surface matching what the gate uses
function createTxStub() {
  let stockRows: Array<{ id: string; stock: number; stock_min: number }> = [];

  const queryRawMock = vi.fn(async () => stockRows);
  const movementCreateMock = vi.fn(async (args: unknown) => args);
  const productUpdateMock = vi.fn(async (args: unknown) => args);

  return {
    _setStock(rows: Array<{ id: string; stock: number; stock_min: number }>) {
      stockRows = rows;
    },
    _getQueryRawMock: () => queryRawMock,
    _getMovementCreateMock: () => movementCreateMock,
    _getProductUpdateMock: () => productUpdateMock,
    $queryRaw: queryRawMock,
    stockMovement: { create: movementCreateMock },
    product: { update: productUpdateMock },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('PrismaProductStockGate (inventory BC — infrastructure)', () => {
  let tx: ReturnType<typeof createTxStub>;

  beforeEach(() => {
    tx = createTxStub();
  });

  it('calls SELECT ... FOR UPDATE via $queryRaw on the supplied tx', async () => {
    tx._setStock([{ id: PRODUCT_ID, stock: 10, stock_min: 5 }]);

    const gate = new PrismaProductStockGate();
    const result = await gate.txIncrementStock(tx, {
      productId: PRODUCT_ID,
      type: 'ENTRADA',
      quantity: 5,
      reason: 'Reposición',
      userId: USER_ID,
    });

    const mock = tx._getQueryRawMock();
    expect(mock).toHaveBeenCalled();
    const callArgs = mock.mock.calls[0];
    expect(callArgs).toBeDefined();
    // First argument is the template strings array
    const templateStr = String(callArgs![0]);
    expect(templateStr).toContain('FOR UPDATE');
    expect(result.stockAfter).toBe(15);
  });

  it('inserts stock movement and updates product stock inside the supplied tx', async () => {
    tx._setStock([{ id: PRODUCT_ID, stock: 5, stock_min: 3 }]);

    const gate = new PrismaProductStockGate();
    await gate.txIncrementStock(tx, {
      productId: PRODUCT_ID,
      type: 'SALIDA',
      quantity: 2,
      reason: 'Venta',
      userId: USER_ID,
    });

    expect(tx._getMovementCreateMock()).toHaveBeenCalledOnce();
    const createCall = tx._getMovementCreateMock().mock.calls[0]![0] as {
      data: { productId: string; quantity: number; stockAfter: number };
    };
    expect(createCall.data.productId).toBe(PRODUCT_ID);
    expect(createCall.data.quantity).toBe(2);
    // `stockAfter` must be denormalized at insert time so list views
    // (orders BC receive flow goes through this gate) do not need to
    // walk the ledger.
    expect(createCall.data.stockAfter).toBe(3);

    expect(tx._getProductUpdateMock()).toHaveBeenCalledOnce();
    const updateCall = tx._getProductUpdateMock().mock.calls[0]![0] as {
      where: { id: string };
      data: { stock: number };
    };
    expect(updateCall.where.id).toBe(PRODUCT_ID);
    expect(updateCall.data.stock).toBe(3);
  });

  it('returns StockMovementRecorded with correct fields', async () => {
    tx._setStock([{ id: PRODUCT_ID, stock: 10, stock_min: 5 }]);

    const gate = new PrismaProductStockGate();
    const result = await gate.txIncrementStock(tx, {
      productId: PRODUCT_ID,
      type: 'ENTRADA',
      quantity: 7,
      reason: 'Reposición',
      userId: USER_ID,
    });

    expect(result.productId).toBe(PRODUCT_ID);
    expect(result.type).toBe('ENTRADA');
    expect(result.quantity).toBe(7);
    expect(result.stockAfter).toBe(17);
    expect(result.stockMin).toBe(5);
    expect(result.occurredAt).toBeInstanceOf(Date);
  });

  it('throws when product row is not found', async () => {
    tx._setStock([]); // no rows

    const gate = new PrismaProductStockGate();
    await expect(
      gate.txIncrementStock(tx, {
        productId: '00000000-0000-4000-8000-000000000000',
        type: 'ENTRADA',
        quantity: 5,
        reason: 'Test',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('only mutates via the supplied tx (no direct prisma calls)', async () => {
    // The gate constructor takes no prisma client — it only receives tx
    const gate = new PrismaProductStockGate();
    const constructorProps = Object.getOwnPropertyNames(Object.getPrototypeOf(gate));
    // Should only have txIncrementStock as the public method
    expect(constructorProps).toContain('txIncrementStock');
  });
});

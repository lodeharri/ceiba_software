import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class StockWouldGoNegativeError extends BaseDomainError {
  constructor(args: { currentStock: number; requested: number; shortBy: number }) {
    super({
      code: ErrorCode.STOCK_WOULD_GO_NEGATIVE,
      httpStatus: 422,
      message: `Stock insuficiente: faltan ${args.shortBy} unidades para esta salida.`,
      details: {
        currentStock: args.currentStock,
        requested: args.requested,
        shortBy: args.shortBy,
      },
    });
  }
}

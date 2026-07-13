/**
 * Alerts BC — PrismaAlertOpenerPort (RF-03 / BR-4).
 *
 * Adapter implementing AlertOpenerPort against Prisma.
 * Uses a Prisma $transaction internally so callers (products BC) do not
 * need to manage a transaction boundary — they just call openIfAbsent(productId).
 *
 * Idempotent: if an ACTIVA alert already exists for the product, the call
 * swallows P2002 from the partial unique index and returns cleanly.
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AlertOpenerPort } from '../domain/ports/alert-opener-port.js';

export class PrismaAlertOpenerPort implements AlertOpenerPort {
  constructor(private readonly prisma: PrismaClient) {}

  async openIfAbsent(productId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.alert.create({
          data: {
            id: randomUUID(),
            productId,
            type: 'STOCK_BAJO',
            status: 'ACTIVA',
            createdAt: new Date(),
          },
        });
      });
    } catch (e: unknown) {
      // P2002 = unique_violation from the BR-4 partial unique index
      // (only one ACTIVA alert per product). Swallow and return — the
      // alert already exists, which is the desired end state.
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: string }).code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }
}

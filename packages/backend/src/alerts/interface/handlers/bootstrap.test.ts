import { describe, expect, it, vi, beforeEach } from 'vitest';
import { bootstrapAlerts } from './bootstrap.js';

// Mock the shared modules
vi.mock('../../../shared/prisma-client.js', () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock('../../../shared/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn(() => ({})),
  })),
}));

describe('Alerts bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a bootstrap with all wired use cases', () => {
    const b = bootstrapAlerts();

    expect(b.prisma).toBeDefined();
    expect(b.logger).toBeDefined();
    expect(b.getAlert).toBeDefined();
    expect(b.listAlerts).toBeDefined();
    expect(typeof b.getAlert.execute).toBe('function');
    expect(typeof b.listAlerts.execute).toBe('function');
  });

  it('creates a PrismaAlertCloserPort adapter', () => {
    const b = bootstrapAlerts();
    expect(b.alertCloserPort).toBeDefined();
    expect(typeof b.alertCloserPort.txCloseIfOpenAndAboveMin).toBe('function');
  });

  it('creates a PrismaAlertRepository adapter', () => {
    const b = bootstrapAlerts();
    expect(b.alertRepository).toBeDefined();
  });

  it('creates a PrismaProductReadPort adapter', () => {
    const b = bootstrapAlerts();
    expect(b.productReadPort).toBeDefined();
  });
});

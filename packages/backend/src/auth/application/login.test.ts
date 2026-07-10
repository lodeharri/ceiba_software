import { beforeEach, describe, expect, it } from 'vitest';
import { LoginUseCase } from './login.js';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.js';
import { RateLimitExceededError } from '../domain/errors/rate-limit-exceeded.js';
import type { UserRepository } from '../domain/ports/user-repository.js';
import type { PasswordHasher } from '../domain/ports/password-hasher.js';
import type { TokenIssuer } from '../domain/ports/token-issuer.js';
import type { RateLimiter, RateLimitDecision } from '../domain/ports/rate-limiter.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const USERNAME = 'admin';
const VALID_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0';
const VALID_PASSWORD = 'super-secret-1234';

function makeUsers(repo: Partial<UserRepository> = {}): UserRepository {
  return {
    findByUsername: async () => null,
    findById: async () => null,
    findByEmail: async () => null,
    ...repo,
  };
}

function makeHasher(
  behavior: 'always-true' | 'always-false' | ((p: string, h: string) => boolean),
): PasswordHasher {
  return {
    async hash(plain: string) {
      return `hash(${plain})`;
    },
    async compare(plain: string, hash: string) {
      if (behavior === 'always-true') return true;
      if (behavior === 'always-false') return false;
      return behavior(plain, hash);
    },
  };
}

function makeIssuer(): TokenIssuer {
  return {
    async issue(claims, expiresInSeconds) {
      return {
        token: `signed(${claims.sub},${claims.role},${expiresInSeconds})`,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      };
    },
  };
}

function makeRateLimiter(
  opts: {
    initialCount?: number;
  } = {},
): RateLimiter & { calls: Array<{ method: string; ip: string; username: string }> } {
  const calls: Array<{ method: string; ip: string; username: string }> = [];
  let count = opts.initialCount ?? 0;
  let blockedUntil: Date | null = null;
  return {
    calls,
    async recordFailure(ip: string, username: string) {
      calls.push({ method: 'recordFailure', ip, username });
      count += 1;
      blockedUntil = count >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      return { count, blockedUntil };
    },
    async recordSuccess(ip: string, username: string) {
      calls.push({ method: 'recordSuccess', ip, username });
      count = 0;
      blockedUntil = null;
    },
    async check(ip: string, username: string): Promise<RateLimitDecision> {
      calls.push({ method: 'check', ip, username });
      void blockedUntil;
      // 5 failures → blocked for 15 min
      if (count >= 5) {
        return { count, blockedUntil: new Date(Date.now() + 15 * 60 * 1000) };
      }
      return { count, blockedUntil: null };
    },
  };
}

describe('LoginUseCase', () => {
  let users: UserRepository;
  let hasher: PasswordHasher;
  let issuer: TokenIssuer;
  let rateLimiter: ReturnType<typeof makeRateLimiter>;

  beforeEach(() => {
    users = makeUsers({
      findByUsername: async (u: string) =>
        u === USERNAME
          ? {
              id: USER_ID,
              email: 'admin@mercadoexpress.local',
              username: u,
              passwordHash: VALID_HASH,
              role: 'admin',
              createdAt: new Date(),
            }
          : null,
    });
    hasher = makeHasher((p, h) => p === VALID_PASSWORD && h === VALID_HASH);
    issuer = makeIssuer();
    rateLimiter = makeRateLimiter({ initialCount: 0 });
  });

  it('returns a token + user envelope on valid credentials', async () => {
    const useCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
    const result = await useCase.execute({
      username: USERNAME,
      password: VALID_PASSWORD,
      ip: '1.2.3.4',
    });
    expect(result.token).toMatch(/^signed\(/);
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.user).toEqual({
      id: USER_ID,
      username: USERNAME,
      role: 'admin',
    });
    // Success path does NOT increment the failure counter (Q-P4).
    expect(rateLimiter.calls.filter((c) => c.method === 'recordFailure')).toHaveLength(0);
    expect(rateLimiter.calls.filter((c) => c.method === 'recordSuccess')).toHaveLength(1);
  });

  it('throws InvalidCredentialsError for an unknown user', async () => {
    const useCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
    await expect(
      useCase.execute({ username: 'ghost', password: 'whatever', ip: '1.2.3.4' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    // Unknown user still records a failure (Q-P4).
    expect(rateLimiter.calls.filter((c) => c.method === 'recordFailure')).toHaveLength(1);
  });

  it('throws InvalidCredentialsError for a wrong password (byte-identical to unknown user)', async () => {
    const useCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
    await expect(
      useCase.execute({ username: USERNAME, password: 'wrong-password', ip: '1.2.3.4' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(rateLimiter.calls.filter((c) => c.method === 'recordFailure')).toHaveLength(1);
  });

  it('throws RateLimitExceededError after the 5-failure threshold is reached', async () => {
    const limited = makeRateLimiter({ initialCount: 5 });
    const useCase = new LoginUseCase(users, hasher, issuer, limited);
    await expect(
      useCase.execute({ username: USERNAME, password: VALID_PASSWORD, ip: '1.2.3.4' }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('a successful login does NOT increment the failure counter (Q-P4)', async () => {
    // Pre-condition: 4 failures already recorded.
    rateLimiter = makeRateLimiter({ initialCount: 4 });
    const useCase = new LoginUseCase(users, hasher, issuer, rateLimiter);
    await useCase.execute({ username: USERNAME, password: VALID_PASSWORD, ip: '1.2.3.4' });
    // No recordFailure was invoked.
    expect(rateLimiter.calls.filter((c) => c.method === 'recordFailure')).toHaveLength(0);
    // recordSuccess IS invoked and resets the counter.
    expect(rateLimiter.calls.filter((c) => c.method === 'recordSuccess')).toHaveLength(1);
  });

  it('different (ip, username) pairs share NO counter', async () => {
    const seenIps: string[] = [];
    const seenUsers: string[] = [];
    const isolated = {
      async recordFailure(ip: string, username: string) {
        seenIps.push(ip);
        seenUsers.push(username);
        return { count: 1, blockedUntil: null };
      },
      async recordSuccess(_ip: string, _username: string) {
        /* no-op */
      },
      async check(_ip: string, _username: string): Promise<RateLimitDecision> {
        return { count: 0, blockedUntil: null };
      },
    } satisfies RateLimiter;
    const useCase = new LoginUseCase(users, hasher, issuer, isolated);
    // Both calls throw (wrong password) but that is fine — we only care
    // that the rate limiter receives the (ip, username) pair unchanged.
    await useCase
      .execute({ username: USERNAME, password: 'whatever', ip: '1.2.3.4' })
      .catch(() => undefined);
    await useCase
      .execute({ username: USERNAME, password: 'whatever', ip: '5.6.7.8' })
      .catch(() => undefined);
    expect(seenIps).toEqual(['1.2.3.4', '5.6.7.8']);
    expect(seenUsers).toEqual([USERNAME, USERNAME]);
  });
});

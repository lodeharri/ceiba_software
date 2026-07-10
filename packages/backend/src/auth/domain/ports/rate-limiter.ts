/**
 * Auth BC — RateLimiter port (PR 2a, RISK-003).
 *
 * The adapter is `PostgresRateLimiter` (login_attempts table). Per
 * Q-P4, only failures count toward the budget; a successful login
 * does NOT increment the counter (the implementation resets the
 * failure rows for the (ip, username) pair).
 *
 * `blockedUntil` is null when count < threshold; otherwise it's the
 * absolute UTC instant the block expires (now + window).
 */

export interface RateLimitDecision {
  count: number;
  blockedUntil: Date | null;
}

export interface RateLimiter {
  /** Records a failed attempt. Returns the updated decision. */
  recordFailure(ip: string, username: string): Promise<RateLimitDecision>;
  /** Resets the failure counter for the (ip, username) pair. */
  recordSuccess(ip: string, username: string): Promise<void>;
  /** Returns the current decision without recording anything. */
  check(ip: string, username: string): Promise<RateLimitDecision>;
}

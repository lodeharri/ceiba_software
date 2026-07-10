/**
 * Unit tests for the auth Pinia store.
 *
 * Covers the public surface actually exposed by the store:
 *   - initial state has no token
 *   - login() persists token, user and expiresAt
 *   - logout() clears the session back to the initial state
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth';

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts with no token, user or expiry', () => {
    const store = useAuthStore();

    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(store.expiresAt).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  it('login() stores token, user and expiresAt (and exposes them via the store)', () => {
    const store = useAuthStore();
    const session = {
      token: 'jwt-token-123',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u-1', username: 'admin', role: 'ADMIN' as const },
    };

    store.login(session);

    expect(store.token).toBe('jwt-token-123');
    expect(store.user).toEqual(session.user);
    expect(store.expiresAt).toBe('2099-01-01T00:00:00.000Z');
    expect(store.isAuthenticated).toBe(true);
  });

  it('logout() returns the store to its initial state', () => {
    const store = useAuthStore();
    store.login({
      token: 'jwt-token-123',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u-1', username: 'admin', role: 'ADMIN' as const },
    });

    store.logout();

    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(store.expiresAt).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });
});

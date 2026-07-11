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
import { isAuthUser, useAuthStore } from './auth';

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
      user: { id: 'u-1', username: 'admin', role: 'admin' as const },
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
      user: { id: 'u-1', username: 'admin', role: 'admin' as const },
    });

    store.logout();

    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(store.expiresAt).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  describe('isAuthUser guard', () => {
    it('accepts a canonical lowercase-role payload', () => {
      expect(isAuthUser({ id: 'u-1', username: 'admin', role: 'admin' })).toBe(true);
    });

    it('rejects uppercase role (the legacy/wrong casing)', () => {
      expect(isAuthUser({ id: 'u-1', username: 'admin', role: 'ADMIN' })).toBe(false);
    });

    it('rejects non-objects and missing fields', () => {
      expect(isAuthUser(null)).toBe(false);
      expect(isAuthUser(undefined)).toBe(false);
      expect(isAuthUser('string')).toBe(false);
      expect(isAuthUser({ id: 'u-1' })).toBe(false);
      expect(isAuthUser({ id: 'u-1', username: 'admin' })).toBe(false);
    });
  });

  describe('restore()', () => {
    it('clears a stale legacy session whose role casing is uppercase', () => {
      localStorage.setItem('mx_token', 'legacy-jwt');
      localStorage.setItem(
        'mx_user',
        JSON.stringify({ id: 'u-1', username: 'admin', role: 'ADMIN' }),
      );
      localStorage.setItem('mx_expires_at', '2099-01-01T00:00:00.000Z');

      const store = useAuthStore();
      const restored = store.restore();

      expect(restored).toBe(false);
      expect(store.token).toBeNull();
      expect(localStorage.getItem('mx_token')).toBeNull();
    });
  });
});

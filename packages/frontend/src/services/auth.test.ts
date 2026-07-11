/**
 * Unit tests for the auth service.
 *
 * Verifies the wiring between the auth service and the rest of the system:
 *   - login() POSTs to /auth/login with the credentials body
 *   - a successful login response, when handed to the auth store, persists the token
 *   - logout() on the auth store clears the token
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock the http module so the service test stays at the wiring layer.
// We don't want real network or real auth-store side-effects inside the
// ofetch onRequest hook — those are covered elsewhere.
vi.mock('./http', () => ({
  http: vi.fn(),
}));

import { login, InvalidLoginResponseError } from './auth';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

const VALID_USER_ID = '11111111-1111-4111-8111-111111111111';
const VALID_EXPIRES_AT = '2099-01-01T00:00:00.000Z';

describe('auth service', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    sessionStorage.clear();
    mockedHttp.mockReset();
  });

  it('login() POSTs credentials to /auth/login', async () => {
    mockedHttp.mockResolvedValue({
      token: 'jwt-token-xyz',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'admin' },
    });

    await login({ username: 'admin', password: 'secret' });

    expect(mockedHttp).toHaveBeenCalledTimes(1);
    expect(mockedHttp).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'secret' },
    });
  });

  it('a successful login persists the token in the auth store', async () => {
    const response = {
      token: 'jwt-token-xyz',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'admin' as const },
    };
    mockedHttp.mockResolvedValue(response);

    const store = useAuthStore();
    expect(store.token).toBeNull();

    const result = await login({ username: 'admin', password: 'secret' });
    // Simulate the caller wiring the response into the store
    store.login(result);

    expect(store.token).toBe('jwt-token-xyz');
    expect(store.isAuthenticated).toBe(true);
  });

  it('returns the parsed login response with canonical lowercase role', async () => {
    mockedHttp.mockResolvedValue({
      token: 'jwt-token-xyz',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'admin' },
    });

    const result = await login({ username: 'admin', password: 'secret' });

    expect(result.user.role).toBe('admin');
  });

  it('throws InvalidLoginResponseError and logs out when the response casing drifts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = useAuthStore();
    // Simulate a stale session in the store that must be cleared.
    store.login({
      token: 'stale-jwt',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'admin' },
    });
    expect(store.token).toBe('stale-jwt');

    // Backend drifted back to uppercase — Zod must reject this.
    mockedHttp.mockResolvedValue({
      token: 'jwt-token-xyz',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'ADMIN' },
    });

    await expect(login({ username: 'admin', password: 'secret' })).rejects.toBeInstanceOf(
      InvalidLoginResponseError,
    );

    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('logout() clears the token from the auth store', async () => {
    const store = useAuthStore();
    store.login({
      token: 'jwt-token-xyz',
      expiresAt: VALID_EXPIRES_AT,
      user: { id: VALID_USER_ID, username: 'admin', role: 'admin' },
    });
    expect(store.token).toBe('jwt-token-xyz');

    store.logout();

    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });
});

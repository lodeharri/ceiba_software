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

import { login } from './auth';
import { http } from './http';
import { useAuthStore } from '@/stores/auth';

const mockedHttp = vi.mocked(http);

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
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u-1', username: 'admin', role: 'ADMIN' },
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
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u-1', username: 'admin', role: 'ADMIN' as const },
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

  it('logout() clears the token from the auth store', async () => {
    const store = useAuthStore();
    store.login({
      token: 'jwt-token-xyz',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: { id: 'u-1', username: 'admin', role: 'ADMIN' },
    });
    expect(store.token).toBe('jwt-token-xyz');

    store.logout();

    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });
});

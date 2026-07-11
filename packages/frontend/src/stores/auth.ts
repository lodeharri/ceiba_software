/**
 * Auth store — MercadoExpress SPA.
 * Manages JWT token, user session, per-tab UUID for X-Request-Id (RISK-S06).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// Per-tab UUID — stable within a browser tab, regenerated on new tab
const TAB_ID_KEY = 'mx_tab_id';

function getOrCreateTabId(): string {
  const stored = sessionStorage.getItem(TAB_ID_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  sessionStorage.setItem(TAB_ID_KEY, id);
  return id;
}

// Canonical role casing is lowercase — see shared/src/primitives/role.ts
// and the backend (which emits 'admin' in login responses and JWT claims).
export interface AuthUser {
  id: string;
  username: string;
  role: 'admin';
}

/**
 * Runtime guard for `AuthUser`. Used at every trust boundary (service
 * responses, restored localStorage payloads) so a malformed session is
 * rejected loudly instead of silently corrupting the store.
 */
export function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && typeof v['username'] === 'string' && v['role'] === 'admin';
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null);
  const user = ref<AuthUser | null>(null);
  const expiresAt = ref<string | null>(null);
  const tabId = ref<string>(getOrCreateTabId());

  const isAuthenticated = computed(() => {
    if (!token.value || !expiresAt.value) return false;
    return new Date(expiresAt.value) > new Date();
  });

  /** Restore session from localStorage on app boot */
  function restore(): boolean {
    const storedToken = localStorage.getItem('mx_token');
    const storedUser = localStorage.getItem('mx_user');
    const storedExpires = localStorage.getItem('mx_expires_at');

    if (storedToken && storedUser && storedExpires) {
      if (new Date(storedExpires) > new Date()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(storedUser);
        } catch {
          // Corrupt JSON — fall through to cleanup
          parsed = null;
        }
        if (isAuthUser(parsed)) {
          token.value = storedToken;
          user.value = parsed;
          expiresAt.value = storedExpires;
          return true;
        }
      }
      // Expired or malformed payload — clear (self-heal legacy 'ADMIN'
      // sessions from before the casing was canonicalised)
      localStorage.removeItem('mx_token');
      localStorage.removeItem('mx_user');
      localStorage.removeItem('mx_expires_at');
    }
    return false;
  }

  function login(data: { token: string; expiresAt: string; user: AuthUser }) {
    token.value = data.token;
    user.value = data.user;
    expiresAt.value = data.expiresAt;

    localStorage.setItem('mx_token', data.token);
    localStorage.setItem('mx_user', JSON.stringify(data.user));
    localStorage.setItem('mx_expires_at', data.expiresAt);
  }

  function logout() {
    token.value = null;
    user.value = null;
    expiresAt.value = null;

    localStorage.removeItem('mx_token');
    localStorage.removeItem('mx_user');
    localStorage.removeItem('mx_expires_at');
  }

  return { token, user, expiresAt, tabId, isAuthenticated, restore, login, logout };
});

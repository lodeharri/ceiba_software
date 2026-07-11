/**
 * Auth service — MercadoExpress SPA.
 *
 * Every response from `/auth/login` is validated against the shared
 * `loginResponseSchema` so a contract drift between backend and frontend
 * (e.g. role casing) fails LOUDLY at the boundary instead of corrupting
 * the auth store with a poisoned session.
 */
import { http } from './http';
import { useAuthStore } from '@/stores/auth';
import { loginResponseSchema, type LoginRequest, type LoginResponse } from '@mercadoexpress/shared';

export type { LoginRequest, LoginResponse };

export class InvalidLoginResponseError extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'InvalidLoginResponseError';
  }
}

export async function login(input: LoginRequest): Promise<LoginResponse> {
  const response = await http<unknown>('/auth/login', {
    method: 'POST',
    body: input,
  });

  const parsed = loginResponseSchema.safeParse(response);
  if (!parsed.success) {
    // Loud failure: log the offending payload, clear any stale session,
    // and throw a user-friendly error so the caller can surface it.

    console.error('[auth] login response failed Zod validation', {
      issues: parsed.error.issues,
      payload: response,
    });
    try {
      useAuthStore().logout();
    } catch {
      // Store may not be initialised in some test contexts — ignore.
    }
    throw new InvalidLoginResponseError(
      'El servidor devolvió una respuesta de inicio de sesión inválida.',
      response,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

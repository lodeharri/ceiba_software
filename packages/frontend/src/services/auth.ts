/**
 * Auth service — MercadoExpress SPA.
 */
import { http } from './http';
import type { LoginRequest, LoginResponse } from '@mercadoexpress/shared/schemas/auth/index.js';

export type { LoginRequest, LoginResponse };

export async function login(input: LoginRequest): Promise<LoginResponse> {
  return http<LoginResponse>('/auth/login', {
    method: 'POST',
    body: input,
  });
}

/**
 * Auth BC bootstrap (PR 2a).
 *
 * Lambda entry file for the auth-lambda. The auth-lambda serves exactly
 * one route: `POST /api/v1/auth/login`. The route does NOT require a
 * Bearer token (it issues them), so the handler is exported bare — no
 * `withJwt` wrap.
 *
 * The Lambda entry in `ApiStack` references this file with
 * `handler: 'handler'`.
 */

export { handler } from './login.js';

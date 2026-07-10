/**
 * Auth BC — InvalidCredentialsError (PR 2a).
 *
 * 401 INVALID_CREDENTIALS — returned for both "unknown user" and
 * "wrong password" so attackers cannot enumerate accounts
 * (auth/spec.md "Login rejects wrong credentials with 401 (no enumeration)").
 */

import { ErrorCode } from '@mercadoexpress/shared';
import { BaseDomainError } from '../../../shared/errors/base-domain-error.js';

export class InvalidCredentialsError extends BaseDomainError {
  public constructor() {
    super({
      code: ErrorCode.INVALID_CREDENTIALS,
      httpStatus: 401,
      message: 'Credenciales inválidas.',
    });
  }
}

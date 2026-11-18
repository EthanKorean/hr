export type AuthErrorCode = 'invalid_credentials' | 'too_many_attempts' | 'bad_request' | 'expired' | 'unauthorized';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string) {
    super(message);
  }
}

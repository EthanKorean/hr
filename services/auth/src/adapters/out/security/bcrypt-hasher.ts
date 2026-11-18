import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../../application/ports.js';

export class BcryptHasher implements PasswordHasher {
  hash(plain: string) {
    return bcrypt.hash(plain, 10);
  }
  verify(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }
}

import { AuthError } from '../domain/errors.js';
import type { AdminRepository, LoginAttemptLimiter, PasswordDecryptor, PasswordHasher, TokenService } from './ports.js';

export class AuthService {
  constructor(
    private readonly admins: AdminRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly limiter: LoginAttemptLimiter,
    private readonly decryptor: PasswordDecryptor,
  ) {}

  private dummyHash?: Promise<string>;

  publicKey() {
    return this.decryptor.publicKey();
  }

  async login(email: string, encryptedPassword: string, ip: string) {
    const key = `${ip}:${email.toLowerCase()}`;
    if (!(await this.limiter.tryAttempt(key))) {
      throw new AuthError('too_many_attempts', '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.');
    }
    const password = await this.decryptor.decrypt(encryptedPassword);

    const admin = await this.admins.findByEmail(email);
    // 계정이 없어도 bcrypt 비교를 수행해 응답 시간으로 이메일 존재 여부가 드러나지 않게 한다.
    const hash = admin?.passwordHash ?? (await (this.dummyHash ??= this.hasher.hash('timing-equalizer')));
    const verified = await this.hasher.verify(password, hash);
    if (!admin || !verified) {
      throw new AuthError('invalid_credentials', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    await this.limiter.reset(key);
    return { token: this.tokens.issue(admin.id), admin: { id: admin.id, email: admin.email, name: admin.name } };
  }

  /** gateway 가 호출하는 토큰 검증. 유효하면 adminId 반환 */
  async verify(token: string): Promise<{ adminId: number }> {
    const claims = this.tokens.parse(token);
    if (!claims || (await this.tokens.isRevoked(claims.jti))) {
      throw new AuthError('unauthorized', '인증이 필요합니다.');
    }
    return { adminId: claims.adminId };
  }

  async logout(token: string): Promise<void> {
    const claims = this.tokens.parse(token);
    if (claims) await this.tokens.revoke(claims);
  }
}

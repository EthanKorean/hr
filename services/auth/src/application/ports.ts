import type { Admin } from '../domain/admin.js';

// ===== Outbound ports: application 이 외부 세계에 요구하는 계약 =====

export interface AdminRepository {
  findByEmail(email: string): Promise<Admin | null>;
  count(): Promise<number>;
  create(a: { email: string; passwordHash: string; name: string }): Promise<void>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface TokenClaims {
  adminId: number;
  jti: string;
  exp: number; // epoch seconds
}

export interface TokenService {
  issue(adminId: number): string;
  /** 서명/만료만 검증. 유효하지 않으면 null */
  parse(token: string): TokenClaims | null;
  isRevoked(jti: string): Promise<boolean>;
  revoke(claims: TokenClaims): Promise<void>;
}

export interface LoginAttemptLimiter {
  /** 시도 1회를 원자적으로 소모한다. 한도를 넘었으면 false (동시 요청이 검사-기록 사이를 통과하지 못하게 한다) */
  tryAttempt(key: string): Promise<boolean>;
  reset(key: string): Promise<void>;
}

/** 클라이언트가 RSA 로 암호화해 보낸 비밀번호를 복호화 (만료/재전송 검사 포함) */
export interface PasswordDecryptor {
  publicKey(): string;
  decrypt(cipherB64: string): Promise<string>; // 실패 시 AuthError('bad_request' | 'expired')
}

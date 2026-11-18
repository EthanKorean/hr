import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { TokenClaims, TokenService } from '../../../application/ports.js';
import { redis } from '../redis/redis.js';

export class JwtTokenService implements TokenService {
  constructor(private readonly secret: string) {}

  issue(adminId: number) {
    return jwt.sign({ role: 'admin' }, this.secret, { subject: String(adminId), expiresIn: '12h', jwtid: randomUUID() });
  }

  parse(token: string): TokenClaims | null {
    try {
      const p = jwt.verify(token, this.secret) as jwt.JwtPayload;
      if (p.role !== 'admin' || !p.jti || !p.sub || !p.exp) return null;
      return { adminId: Number(p.sub), jti: p.jti, exp: p.exp };
    } catch {
      return null;
    }
  }

  async isRevoked(jti: string) {
    return (await redis.exists(`revoked:${jti}`).catch(() => 0)) > 0;
  }

  /** 토큰 남은 수명만큼만 블랙리스트에 유지 */
  async revoke(c: TokenClaims) {
    const ttl = c.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await redis.set(`revoked:${c.jti}`, '1', 'EX', ttl);
  }
}

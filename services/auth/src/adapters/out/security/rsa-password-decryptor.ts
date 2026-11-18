import { constants, generateKeyPair, privateDecrypt, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordDecryptor } from '../../../application/ports.js';
import { AuthError } from '../../../domain/errors.js';
import { redis } from '../redis/redis.js';

const MAX_SKEW_MS = 60_000;

/**
 * 로그인 비밀번호 구간 암호화용 RSA-4096 (RSA-OAEP / SHA-256). 모든 로그인 경로 공용.
 * 개인키는 메모리에만 존재(재시작 시 교체). TLS 를 대체하지 않는다.
 * 평문은 {p: 비밀번호, t: epoch ms, n: nonce}. 시간 오차 ±60초, nonce 1회용(Redis)으로 재전송 차단.
 */
export class RsaPasswordDecryptor implements PasswordDecryptor {
  private constructor(private readonly priv: KeyObject, private readonly pubB64: string) {}

  static async create() {
    const t = Date.now();
    const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 4096 });
    console.log(`[rsa] 4096-bit key generated (${Date.now() - t}ms)`);
    return new RsaPasswordDecryptor(privateKey, publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  }

  publicKey() {
    return this.pubB64;
  }

  async decrypt(cipherB64: string) {
    let plain: { p: unknown; t: unknown; n: unknown };
    try {
      const buf = privateDecrypt(
        { key: this.priv, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(cipherB64, 'base64'),
      );
      plain = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new AuthError('bad_request', '잘못된 로그인 요청입니다.');
    }
    // JSON.parse 는 null/숫자 등도 돌려준다 (공개키로 누구나 암호문을 만들 수 있으므로 500 이 아니라 400 으로 거절)
    if (!plain || typeof plain !== 'object' || typeof plain.p !== 'string' || typeof plain.n !== 'string' || typeof plain.t !== 'number') {
      throw new AuthError('bad_request', '잘못된 로그인 요청입니다.');
    }
    if (Math.abs(Date.now() - plain.t) > MAX_SKEW_MS) {
      throw new AuthError('expired', '요청 시간이 만료되었습니다. 다시 시도하세요.');
    }
    // nonce 1회 사용. Redis 장애 시 재전송 검사는 건너뜀(fail-open)
    // TTL 은 허용 시간 창(±MAX_SKEW_MS = 최대 2*MAX_SKEW_MS)보다 길어야 창 끝 경계에서 재전송이 통과하지 못한다.
    const ok = await redis.set(`nonce:${plain.n}`, '1', 'EX', Math.ceil((2 * MAX_SKEW_MS) / 1000) + 60, 'NX').catch(() => 'OK');
    if (ok !== 'OK') throw new AuthError('bad_request', '잘못된 로그인 요청입니다.');
    return plain.p;
  }
}

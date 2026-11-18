import type { LoginAttemptLimiter } from '../../../application/ports.js';
import { redis } from './redis.js';

const MAX_FAILS = 5;
const WINDOW_SEC = 600;
const k = (key: string) => `login:fail:${key}`;

// Redis 장애 시 fail-open (스터디용). 운영에서는 fail-closed 검토.
export class RedisLoginLimiter implements LoginAttemptLimiter {
  // INCR 이 원자적이므로 동시 요청도 한도(MAX_FAILS)를 넘어 통과할 수 없다. 창은 첫 시도부터 WINDOW_SEC (EXPIRE NX, Redis 7+).
  async tryAttempt(key: string) {
    const res = await redis.multi().incr(k(key)).expire(k(key), WINDOW_SEC, 'NX').exec().catch(() => null);
    const count = Number(res?.[0]?.[1]);
    return Number.isNaN(count) || count <= MAX_FAILS;
  }
  async reset(key: string) {
    await redis.del(k(key)).catch(() => null);
  }
}

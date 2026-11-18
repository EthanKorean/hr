import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { AuthService } from './application/auth-service.js';
import { ensureAdmin } from './application/ensure-admin.js';
import { MysqlAdminRepository } from './adapters/out/mysql/admin-repository.js';
import { migrate } from './adapters/out/mysql/pool.js';
import { RedisLoginLimiter } from './adapters/out/redis/redis-login-limiter.js';
import { BcryptHasher } from './adapters/out/security/bcrypt-hasher.js';
import { JwtTokenService } from './adapters/out/security/jwt-token-service.js';
import { RsaPasswordDecryptor } from './adapters/out/security/rsa-password-decryptor.js';
import { buildRouter } from './adapters/in/http/router.js';

// 조립(composition root): 포트 구현체(adapter)를 골라 application 에 주입한다.
const admins = new MysqlAdminRepository();
const hasher = new BcryptHasher();
// RSA-4096 키 생성(수 초)과 DB 마이그레이션은 서로 독립이므로 병렬로 수행
const [decryptor] = await Promise.all([RsaPasswordDecryptor.create(), migrate()]);
const auth = new AuthService(admins, hasher, new JwtTokenService(config.jwtSecret), new RedisLoginLimiter(), decryptor);
await ensureAdmin(admins, hasher, { email: config.adminEmail, password: config.adminPassword });

const app = express();
app.set('trust proxy', config.trustProxyHops); // TRUST_PROXY_HOPS
app.use(express.json());
app.use(buildRouter(auth, config.internalKey));
// express.json() 의 본문 파싱 오류(잘못된 JSON)도 {error} 형태로 응답
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) =>
  err.type?.startsWith('entity.')
    ? res.status(err.status ?? 400).json({ error: err.type === 'entity.too.large' ? '요청 본문이 너무 큽니다.' : '잘못된 JSON 요청입니다.' })
    : next(err),
);
app.listen(config.port, () => console.log(`[auth-service] listening on :${config.port}`));

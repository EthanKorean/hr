import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../../../application/auth-service.js';
import { AuthError, type AuthErrorCode } from '../../../domain/errors.js';

const STATUS: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  unauthorized: 401,
  too_many_attempts: 429,
  bad_request: 400,
  expired: 400,
};

const sameKey = (a: unknown, b: string) => {
  const x = Buffer.from(typeof a === 'string' ? a : '');
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const ah = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) =>
  fn(req, res).catch(next);

const bearer = (req: Request) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

// 길이 상한: 제한 키(login:fail:ip:email)가 임의 길이로 Redis 에 쌓이지 않게 한다. (email 컬럼 190, RSA-4096 암호문 base64 = 684자)
const loginSchema = z.object({ email: z.string().email().max(190), encryptedPassword: z.string().min(1).max(1024) });

export function buildRouter(auth: AuthService, internalKey: string) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));

  // 모든 로그인(Admin/고객사)이 공용으로 쓰는 공개키 (SPKI DER, base64)
  r.get('/auth/public-key', (_req, res) => res.json({ algorithm: 'RSA-OAEP-SHA256', publicKey: auth.publicKey(), serverTime: Date.now() }));

  r.post(
    '/auth/admin/login',
    ah(async (req, res) => {
      const p = loginSchema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: '이메일/비밀번호를 확인하세요.' });
      res.json(await auth.login(p.data.email, p.data.encryptedPassword, req.ip ?? ''));
    }),
  );

  r.post(
    '/auth/admin/logout',
    ah(async (req, res) => {
      await auth.logout(bearer(req));
      res.status(204).end();
    }),
  );

  // gateway 전용(내부망). 토큰이 유효하면 adminId 를 돌려준다.
  r.post(
    '/internal/verify',
    ah(async (req, res) => {
      if (!sameKey(req.headers['x-internal-key'], internalKey)) return res.status(403).json({ error: 'forbidden' });
      res.json(await auth.verify(bearer(req)));
    }),
  );

  r.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuthError) return res.status(STATUS[err.code]).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return r;
}

import express, { type NextFunction, type Request, type Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`환경변수 ${k} 가 필요합니다.`);
  return v;
};
const PORT = Number(process.env.PORT ?? 3000);
const AUTH = env('AUTH_URL');
const TENANT = env('TENANT_URL');
const INTERNAL_KEY = env('INTERNAL_KEY');

const app = express(); // 본문을 파싱하지 않고 그대로 프록시한다.

// 외부에서 위조한 내부용 헤더는 무조건 제거
app.use((req, _res, next) => {
  delete req.headers['x-internal-key'];
  delete req.headers['x-admin-id'];
  next();
});

// 준비 상태 = 하위 서비스가 모두 응답
app.get('/api/health', async (_req, res) => {
  const ok = async (u: string) => {
    const r = await fetch(`${u}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    await r?.body?.cancel().catch(() => undefined); // 본문을 읽지 않으면 keep-alive 연결이 GC 때까지 풀에 묶인다
    return r?.ok === true;
  };
  const [auth, tenant] = await Promise.all([ok(AUTH), ok(TENANT)]);
  res.status(auth && tenant ? 200 : 503).json({ ok: auth && tenant, services: { auth, tenant } });
});

// 인증이 필요한 경로: auth-service 에 토큰 검증을 위임하고, 통과하면 내부 키/관리자 id 를 붙여 전달
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await fetch(`${AUTH}/internal/verify`, {
      method: 'POST',
      headers: { authorization: req.headers.authorization ?? '', 'x-internal-key': INTERNAL_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 401) {
      await r.body?.cancel().catch(() => undefined);
      return res.status(401).json({ error: '인증이 필요합니다.' });
    }
    // 401 이외(내부 키 불일치/서버 오류)는 인증 실패가 아니므로 프론트가 로그아웃하지 않도록 502 로 구분한다.
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      return res.status(502).json({ error: '인증 서비스 오류가 발생했습니다.' });
    }
    const { adminId } = (await r.json()) as { adminId: number };
    req.headers['x-admin-id'] = String(adminId);
    req.headers['x-internal-key'] = INTERNAL_KEY;
    next();
  } catch {
    res.status(502).json({ error: '인증 서비스에 연결할 수 없습니다.' });
  }
}
// 라우팅 테이블 (외부 경로 -> 서비스 내부 경로). 인증 여부(protect)를 라우트 선언에 함께 둬서,
// 새 라우트를 추가하면서 인증 접두사 목록 갱신을 빠뜨려 인증 없이 열리는 일이 없게 한다.
// 인증 검사와 프록시 매칭이 같은 판별 함수(startsWith)를 공유한다.
// (app.use(path) 는 경계 단위로 매칭되어 '/api/admin/tenantsX' 가 인증 없이 프록시에 도달할 수 있었다.
//  또 문자열 pathFilter 는 내부적으로 url.parse 를 써서 '/api\admin\tenants' 의 역슬래시를 '/' 로 바꿔 매칭하므로,
//  req.path 기반 인증 검사와 어긋나지 않게 pathFilter 도 같은 함수로 지정한다.)
const route = (target: string, prefix: string, to: string, protect: boolean) => {
  // 경로 경계 단위로 매칭: '/api/admin/auth' 는 허용하되 '/api/admin/authXYZ' 는 라우팅하지 않는다.
  const matches = (req: { path: string }) => req.path === prefix || req.path.startsWith(`${prefix}/`);
  if (protect) app.use((req, res, next) => (matches(req) ? requireAdmin(req, res, next) : next()));
  // xfwd: auth-service 의 로그인 시도 제한이 gateway IP 가 아니라 실제 클라이언트 IP 를 쓰도록 X-Forwarded-For 를 전달한다.
  app.use(
    createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      pathFilter: (_pathname, req) => matches(req as unknown as Request),
      pathRewrite: { [`^${prefix}`]: to },
    }),
  );
};

route(AUTH, '/api/auth/public-key', '/auth/public-key', false); // 공개키만 노출 (auth 의 나머지 /auth/* 는 외부 비공개)
route(AUTH, '/api/admin/auth', '/auth/admin', false); // login / logout
route(TENANT, '/api/admin/tenants', '/tenants', true);

app.listen(PORT, () => console.log(`[gateway] listening on :${PORT}`));

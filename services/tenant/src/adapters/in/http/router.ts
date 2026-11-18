import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { TenantService } from '../../../application/tenant-service.js';
import { ConflictError, DuplicateBizNoError, NotFoundError, ValidationError } from '../../../domain/errors.js';

const sameKey = (a: unknown, b: string) => {
  const x = Buffer.from(typeof a === 'string' ? a : '');
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const ah = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) =>
  fn(req, res).catch(next);

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, '존재하지 않는 날짜입니다.');

// 숫자가 아닌 id 가 DB 까지 내려가 500 이 되지 않도록 404 로 처리한다.
const idOf = (req: Request) => {
  // Number() 는 '1e3', '0x10', ' 5 ' 도 숫자로 받아들이므로 10진 숫자만 허용한다.
  const n = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) throw new NotFoundError();
  return n;
};
const tenantSchema = z.object({
  name: z.string().trim().min(1).max(150),
  bizNo: z.string().trim().regex(/^\d{3}-?\d{2}-?\d{5}$/, '사업자등록번호 형식(000-00-00000)'),
  contactName: z.string().trim().min(1).max(100),
  contactEmail: z.string().email().max(190), // 컬럼 길이(VARCHAR(190)) 초과 시 DB 오류(500) 방지
  contactPhone: z.string().trim().max(30).default(''),
  maxEmployees: z.number().int().min(1).max(100000),
  startDate: date,
  endDate: date,
  status: z.enum(['active', 'suspended']).default('active'),
});

// PUT 은 전체 교체이므로 status 를 생략하면 400 (기본값 'active' 로 정지된 고객사가 조용히 해제되는 것을 막는다)
// PUT 은 전체 교체: 생략된 선택 필드가 기본값('active'/'')으로 조용히 덮어써지지 않도록 status/contactPhone 을 필수로 한다.
const updateSchema = tenantSchema.extend({ status: z.enum(['active', 'suspended']), contactPhone: z.string().trim().max(30) });

const FIELD_LABEL: Record<string, string> = {
  name: '회사명',
  bizNo: '사업자등록번호',
  contactName: '담당자명',
  contactEmail: '담당자 이메일',
  contactPhone: '연락처',
  maxEmployees: '최대 근로자 수',
  startDate: '사용 시작일',
  endDate: '사용 종료일',
  status: '상태',
};

const parseBody = (req: Request, res: Response, schema: typeof tenantSchema | typeof updateSchema = tenantSchema) => {
  const p = schema.safeParse(req.body);
  if (!p.success) {
    // zod 기본 메시지("Required", "Invalid email" 등)는 영어라 화면에 그대로 보이면 어느 항목인지 알 수 없다. 항목명을 붙인다.
    const i = p.error.issues[0];
    const label = FIELD_LABEL[String(i.path[0])] ?? '입력값';
    res.status(400).json({ error: `${label}을(를) 확인하세요. (${i.message})`, issues: p.error.issues });
    return null;
  }
  return p.data;
};

export function buildRouter(svc: TenantService, internalKey: string) {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ ok: true }));

  // 이하 전부 gateway 를 거친 요청만 허용 (gateway 가 JWT 검증 후 내부 키를 붙임)
  r.use('/tenants', (req, res, next) =>
    sameKey(req.headers['x-internal-key'], internalKey) ? next() : res.status(403).json({ error: 'forbidden' }),
  );

  r.get('/tenants', ah(async (req, res) => res.json(await svc.list(typeof req.query.q === 'string' ? req.query.q : ''))));
  r.get('/tenants/:id', ah(async (req, res) => res.json(await svc.get(idOf(req)))));

  r.post('/tenants', ah(async (req, res) => {
    const v = parseBody(req, res);
    if (v) res.status(201).json(await svc.register(v));
  }));

  r.put('/tenants/:id', ah(async (req, res) => {
    const v = parseBody(req, res, updateSchema);
    if (v) res.json(await svc.update(idOf(req), v));
  }));

  r.post('/tenants/:id/extend', ah(async (req, res) => {
    const p = z.object({ months: z.number().int().min(1).max(60) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: '연장 개월 수를 확인하세요.' });
    res.json(await svc.extend(idOf(req), p.data.months));
  }));

  r.delete('/tenants/:id', ah(async (req, res) => {
    await svc.remove(idOf(req));
    res.status(204).end();
  }));

  // 도메인 에러 -> HTTP 상태 매핑은 이 어댑터의 책임
  r.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof ConflictError || err instanceof DuplicateBizNoError) return res.status(409).json({ error: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return r;
}

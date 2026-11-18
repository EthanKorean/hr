import { ValidationError } from './errors.js';

export type TenantStatus = 'active' | 'suspended';
export type EffectiveStatus = 'active' | 'suspended' | 'expired' | 'scheduled';

export interface TenantProps {
  name: string;
  bizNo: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  maxEmployees: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (포함)
  status: TenantStatus;
}

export interface Tenant extends TenantProps {
  id: number;
  createdAt: string;
}

export const normalizeBizNo = (s: string) => s.replace(/\D/g, '').replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3');

/** 불변식: 종료일은 시작일 이후 */
export function assertValid(p: TenantProps) {
  if (p.endDate < p.startDate) throw new ValidationError('종료일은 시작일 이후여야 합니다.');
}

/** 수동 정지 > 만료 > 시작 예정 > 사용중 */
export function effectiveStatus(t: Pick<Tenant, 'status' | 'startDate' | 'endDate'>, today: string): EffectiveStatus {
  if (t.status === 'suspended') return 'suspended';
  if (t.endDate < today) return 'expired';
  if (t.startDate > today) return 'scheduled';
  return 'active';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' 에 개월 수를 더한다. 말일 초과 시 말일로 보정(1/31 + 1개월 = 2/28) */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

/** 연장: 현재 종료일(이미 만료됐다면 오늘) 기준 N개월 */
export function extendedEndDate(t: Pick<Tenant, 'endDate'>, months: number, today: string): string {
  const end = addMonths(t.endDate > today ? t.endDate : today, months);
  // DATE 컬럼 상한(9999-12-31) 초과 시 DB 오류(500) 대신 검증 오류(400)로 거절한다.
  if (Number(end.slice(0, end.indexOf('-'))) > 9999) throw new ValidationError('종료일은 9999년을 넘을 수 없습니다.');
  return end;
}

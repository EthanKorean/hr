import type { Tenant, TenantProps } from '../domain/tenant.js';

export interface TenantRepository {
  search(q: string): Promise<Tenant[]>;
  findById(id: number): Promise<Tenant | null>;
  /** 사업자번호 중복 시 DuplicateBizNoError */
  insert(p: TenantProps): Promise<Tenant>;
  update(id: number, p: TenantProps): Promise<Tenant | null>;
  /** 종료일이 expectedEndDate 일 때만 변경(낙관적 갱신). 그 사이 바뀌었거나 없으면 null */
  setEndDateIf(id: number, expectedEndDate: string, endDate: string): Promise<Tenant | null>;
  delete(id: number): Promise<boolean>;
}

/** 다른 서비스가 구독하는 도메인 이벤트 발행 */
export interface EventPublisher {
  publish(topic: string, payload: unknown): void;
}

export interface Clock {
  today(): string; // YYYY-MM-DD
}

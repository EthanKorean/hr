import { ConflictError, NotFoundError } from '../domain/errors.js';
import {
  assertValid,
  effectiveStatus,
  extendedEndDate,
  normalizeBizNo,
  type EffectiveStatus,
  type Tenant,
  type TenantProps,
} from '../domain/tenant.js';
import type { Clock, EventPublisher, TenantRepository } from './ports.js';

export type TenantView = Tenant & { effectiveStatus: EffectiveStatus };

export class TenantService {
  constructor(
    private readonly repo: TenantRepository,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  private view(t: Tenant): TenantView {
    return { ...t, effectiveStatus: effectiveStatus(t, this.clock.today()) };
  }

  async list(q = '') {
    return (await this.repo.search(q.trim())).map((t) => this.view(t));
  }

  async get(id: number) {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundError();
    return this.view(t);
  }

  async register(input: TenantProps) {
    const props = { ...input, bizNo: normalizeBizNo(input.bizNo) };
    assertValid(props);
    const v = this.view(await this.repo.insert(props));
    this.events.publish(`hr/tenants/${v.id}/created`, v);
    return v;
  }

  async update(id: number, input: TenantProps) {
    const props = { ...input, bizNo: normalizeBizNo(input.bizNo) };
    assertValid(props);
    const t = await this.repo.update(id, props);
    if (!t) throw new NotFoundError();
    const v = this.view(t);
    this.events.publish(`hr/tenants/${id}/updated`, v);
    return v;
  }

  async extend(id: number, months: number) {
    // 동시 연장이 서로 덮어쓰지 않도록: 읽은 종료일이 그대로일 때만 갱신하고, 아니면 다시 읽어 재계산한다.
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.repo.findById(id);
      if (!cur) throw new NotFoundError();
      const t = await this.repo.setEndDateIf(id, cur.endDate, extendedEndDate(cur, months, this.clock.today()));
      if (t) {
        const v = this.view(t);
        this.events.publish(`hr/tenants/${id}/extended`, v);
        return v;
      }
    }
    throw new ConflictError();
  }

  async remove(id: number) {
    if (!(await this.repo.delete(id))) throw new NotFoundError();
    this.events.publish(`hr/tenants/${id}/deleted`, { id });
  }
}

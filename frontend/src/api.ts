import { encryptPassword } from './crypto';

export type EffectiveStatus = 'active' | 'suspended' | 'expired' | 'scheduled';

export interface Tenant {
  id: number;
  name: string;
  bizNo: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  maxEmployees: number;
  startDate: string;
  endDate: string;
  status: 'active' | 'suspended';
  effectiveStatus: EffectiveStatus;
}

export type TenantInput = Omit<Tenant, 'id' | 'effectiveStatus'>;

const KEY = 'hr_admin_token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export const api = {
  login: async (email: string, password: string) =>
    req<{ token: string; admin: { name: string; email: string } }>('POST', '/api/admin/auth/login', {
      email,
      encryptedPassword: await encryptPassword(password),
    }),
  logout: () => req<void>('POST', '/api/admin/auth/logout').catch(() => undefined),
  listTenants: (q = '') => req<Tenant[]>('GET', `/api/admin/tenants?q=${encodeURIComponent(q)}`),
  createTenant: (v: TenantInput) => req<Tenant>('POST', '/api/admin/tenants', v),
  updateTenant: (id: number, v: TenantInput) => req<Tenant>('PUT', `/api/admin/tenants/${id}`, v),
  extendTenant: (id: number, months: number) => req<Tenant>('POST', `/api/admin/tenants/${id}/extend`, { months }),
  deleteTenant: (id: number) => req<void>('DELETE', `/api/admin/tenants/${id}`),
};

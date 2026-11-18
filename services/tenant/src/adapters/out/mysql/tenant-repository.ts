import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { TenantRepository } from '../../../application/ports.js';
import { DuplicateBizNoError } from '../../../domain/errors.js';
import type { Tenant, TenantProps } from '../../../domain/tenant.js';
import { pool } from './pool.js';

const toTenant = (r: RowDataPacket): Tenant => ({
  id: r.id,
  name: r.name,
  bizNo: r.biz_no,
  contactName: r.contact_name,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  maxEmployees: r.max_employees,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  createdAt: r.created_at,
});

const values = (p: TenantProps) => [
  p.name, p.bizNo, p.contactName, p.contactEmail, p.contactPhone, p.maxEmployees, p.startDate, p.endDate, p.status,
];

async function guardDup<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') throw new DuplicateBizNoError();
    throw e;
  }
}

export class MysqlTenantRepository implements TenantRepository {
  async search(q: string) {
    if (!q) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tenants ORDER BY id DESC');
      return rows.map(toTenant);
    }
    // LIKE 와일드카드(% _ \\)는 사용자 입력이므로 이스케이프한다.
    const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
    // 사업자번호는 하이픈 포함 저장이므로, 숫자만 입력해도 찾을 수 있게 하이픈 제거 값과도 비교한다.
    // 검색어가 숫자/하이픈만으로 된 경우에만 적용한다. ("3M" 같은 혼합 검색어에서 숫자만 뽑아 사업자번호가 엉뚱하게 걸리는 것 방지)
    const digits = /^[\d\s-]+$/.test(q) ? q.replace(/\D/g, '') : '';
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM tenants WHERE name LIKE ? OR biz_no LIKE ?${digits ? " OR REPLACE(biz_no, '-', '') LIKE ?" : ''} ORDER BY id DESC`,
      digits ? [like(q), like(q), like(digits)] : [like(q), like(q)],
    );
    return rows.map(toTenant);
  }

  async findById(id: number) {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tenants WHERE id = ?', [id]);
    return rows[0] ? toTenant(rows[0]) : null;
  }

  insert(p: TenantProps) {
    return guardDup(async () => {
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO tenants (name, biz_no, contact_name, contact_email, contact_phone, max_employees, start_date, end_date, status)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        values(p),
      );
      return (await this.findById(r.insertId))!;
    });
  }

  update(id: number, p: TenantProps) {
    return guardDup(async () => {
      const [r] = await pool.query<ResultSetHeader>(
        `UPDATE tenants SET name=?, biz_no=?, contact_name=?, contact_email=?, contact_phone=?, max_employees=?,
           start_date=?, end_date=?, status=? WHERE id=?`,
        [...values(p), id],
      );
      return r.affectedRows ? this.findById(id) : null;
    });
  }

  async setEndDateIf(id: number, expectedEndDate: string, endDate: string) {
    const [r] = await pool.query<ResultSetHeader>('UPDATE tenants SET end_date = ? WHERE id = ? AND end_date = ?', [
      endDate,
      id,
      expectedEndDate,
    ]);
    return r.affectedRows ? this.findById(id) : null;
  }

  async delete(id: number) {
    const [r] = await pool.query<ResultSetHeader>('DELETE FROM tenants WHERE id = ?', [id]);
    return r.affectedRows > 0;
  }
}

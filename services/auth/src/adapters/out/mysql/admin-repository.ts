import type { RowDataPacket } from 'mysql2';
import type { AdminRepository } from '../../../application/ports.js';
import type { Admin } from '../../../domain/admin.js';
import { pool } from './pool.js';

export class MysqlAdminRepository implements AdminRepository {
  async findByEmail(email: string): Promise<Admin | null> {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM admins WHERE email = ?', [email]);
    const r = rows[0];
    return r ? { id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash } : null;
  }
  async count() {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM admins');
    return Number(rows[0].c);
  }
  async create(a: { email: string; passwordHash: string; name: string }) {
    await pool.query('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)', [a.email, a.passwordHash, a.name]);
  }
}

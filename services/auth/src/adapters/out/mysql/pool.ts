import mysql from 'mysql2/promise';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../../config.js';

export const pool = mysql.createPool({ ...config.db, dateStrings: true, timezone: '+09:00', connectionLimit: 10 });

async function waitForDb(retries = 30) {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      last = e; // 비밀번호 오류 등 원인이 사라지지 않도록 마지막 오류를 함께 보고한다.
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`DB 연결 실패: ${(last as Error | undefined)?.message ?? 'unknown'}`);
}

export async function migrate() {
  await waitForDb();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  const dir = path.resolve('migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name as string));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(dir, f), 'utf8');
    for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
    await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    console.log(`[migrate] applied ${f}`);
  }
}

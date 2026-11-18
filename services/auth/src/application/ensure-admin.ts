import { z } from 'zod';
import type { AdminRepository, PasswordHasher } from './ports.js';

/** 기동 시 admin 이 하나도 없으면 환경변수의 계정으로 생성 */
export async function ensureAdmin(
  admins: AdminRepository,
  hasher: PasswordHasher,
  seed: { email: string; password: string },
) {
  if ((await admins.count()) > 0) return;
  if (!seed.password) throw new Error('admin 이 아직 없는데 ADMIN_PASSWORD 가 비어 있습니다. ./scripts/init.sh --reset 으로 처음부터 구성하세요.');
  // 로그인 경로와 같은 제약을 기동 시점에 확인한다. 아니면 만들어진 admin 으로 로그인할 수 없게 된다.
  //  - 로그인 API 는 z.string().email() 을 통과해야 한다 (예: admin@localhost 는 거절됨)
  //  - 프론트는 72바이트 초과 비밀번호를 전송하지 않는다 (bcrypt 도 72바이트 이후를 무시)
  if (!z.string().email().safeParse(seed.email).success) throw new Error(`ADMIN_EMAIL 형식이 올바르지 않습니다: ${seed.email}`);
  if (Buffer.byteLength(seed.password) > 72) throw new Error('ADMIN_PASSWORD 는 최대 72바이트여야 합니다.');
  await admins.create({ email: seed.email, passwordHash: await hasher.hash(seed.password), name: 'Administrator' });
  console.log(`[seed] admin 생성: ${seed.email}`);
}

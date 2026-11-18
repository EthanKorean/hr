import { defineConfig } from '@playwright/test';

// 실행: 루트에서 ./scripts/e2e.sh (.env 의 설정과 암호화해 보관한 Admin 비밀번호를 환경으로 올려 준다).
// 직접 실행하려면 .env(비밀 아닌 설정)를 환경에 올리고 ADMIN_PASSWORD 를 지정한다.
//   set -a; . ../.env; set +a; read -rs -p 'Admin 비밀번호: ' ADMIN_PASSWORD; export ADMIN_PASSWORD; npx playwright test
for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
  if (!process.env[k]) throw new Error(`환경변수 ${k} 가 필요합니다. (README 의 'E2E (Playwright)' 참고)`);
}

export default defineConfig({
  testDir: './tests',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.FRONTEND_PORT ?? 8000}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

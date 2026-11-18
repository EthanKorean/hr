import { defineConfig } from '@playwright/test';

// 실행 전: .env(비밀 아닌 설정)를 환경에 올리고, 저장되지 않는 Admin 비밀번호를 직접 지정한다.
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

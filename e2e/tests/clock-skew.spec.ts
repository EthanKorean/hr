import { expect, test } from '@playwright/test';

// 브라우저 시계가 서버보다 5분 어긋나 있어도(검증 허용치 ±60초) 서버 시각 보정으로 로그인되어야 한다.
test('로그인: 브라우저 시계가 5분 틀려도 서버 시각으로 보정되어 성공한다', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.now() - 5 * 60 * 1000) });
  await page.goto('/');
  // 모킹이 실제로 적용됐는지 확인 (적용 안 됐다면 이 테스트는 의미가 없다)
  const browserNow = await page.evaluate(() => Date.now());
  expect(Date.now() - browserNow).toBeGreaterThan(4 * 60 * 1000);
  await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('비밀번호').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '고객사 관리' })).toBeVisible();
});

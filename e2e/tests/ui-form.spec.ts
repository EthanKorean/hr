import { expect, test } from '@playwright/test';

test('등록 폼: 최대 근로자 수 입력을 지울 수 있다 (0 으로 되돌아가지 않는다)', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('비밀번호').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('button', { name: '+ 고객사 등록' }).click();
  const max = page.getByLabel('최대 근로자 수');
  await expect(max).toHaveValue('10');
  await max.fill('');
  await expect(max).toHaveValue('');
  await max.fill('25');
  await expect(max).toHaveValue('25');
});

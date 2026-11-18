import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.ADMIN_EMAIL!;
const PASSWORD = process.env.ADMIN_PASSWORD!;

async function login(page: Page, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('이메일').fill(EMAIL);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
}

test('로그인: 비밀번호가 평문이 아니라 RSA 암호문으로 전송된다', async ({ page }) => {
  const reqs: { body: string }[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/admin/auth/login')) reqs.push({ body: r.postData() ?? '' });
  });

  await login(page);
  await expect(page.getByRole('heading', { name: '고객사 관리' })).toBeVisible();

  expect(reqs).toHaveLength(1);
  const body = JSON.parse(reqs[0].body);
  expect(body).not.toHaveProperty('password');
  expect(reqs[0].body).not.toContain(PASSWORD);
  // RSA-4096 암호문 = 512바이트 -> base64 684자
  expect(Buffer.from(body.encryptedPassword, 'base64')).toHaveLength(512);
});

test('로그인: 잘못된 비밀번호는 에러 메시지를 보여준다', async ({ page }) => {
  await login(page, 'wrong-password-xyz');
  await expect(page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '고객사 관리' })).toHaveCount(0);
});

test('고객사 등록 -> 수정(정지) -> 연장 -> 삭제 -> 로그아웃', async ({ page }) => {
  const biz = `${Math.floor(100 + Math.random() * 899)}-${Math.floor(10 + Math.random() * 89)}-${Math.floor(10000 + Math.random() * 89999)}`;
  const name = `E2E 회사 ${Date.now()}`;
  await login(page);
  await expect(page.getByRole('heading', { name: '고객사 관리' })).toBeVisible();

  // 등록
  await page.getByRole('button', { name: '+ 고객사 등록' }).click();
  await page.getByLabel('회사명', { exact: true }).fill(name);
  await page.getByLabel('사업자등록번호').fill(biz.replace(/-/g, ''));
  await page.getByLabel('담당자명').fill('홍길동');
  await page.getByLabel('담당자 이메일').fill('hong@example.com');
  await page.getByRole('button', { name: '저장' }).click();

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(biz); // 하이픈 정규화
  await expect(row.locator('.badge')).toHaveText('사용중');

  // 사업자번호 중복 등록 -> 409 메시지
  await page.getByRole('button', { name: '+ 고객사 등록' }).click();
  await page.getByLabel('회사명', { exact: true }).fill(`${name} dup`);
  await page.getByLabel('사업자등록번호').fill(biz);
  await page.getByLabel('담당자명').fill('김중복');
  await page.getByLabel('담당자 이메일').fill('dup@example.com');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('이미 등록된 사업자등록번호입니다.')).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();

  // 수정: 정지
  await row.getByRole('button', { name: '수정' }).click();
  await page.getByLabel('상태').selectOption('suspended');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(row.locator('.badge')).toHaveText('정지');

  // 수정: 종료일이 시작일보다 빠르면 거부
  await row.getByRole('button', { name: '수정' }).click();
  await page.getByLabel('사용 종료일').fill('2000-01-01');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('종료일은 시작일 이후여야 합니다.')).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();

  // 연장 (+12개월): 종료일이 1년 늘어난다
  const before = (await row.locator('td').nth(4).innerText()).split('~')[1].trim();
  page.once('dialog', (d) => d.accept('12'));
  await row.getByRole('button', { name: '연장' }).click();
  await expect(row.locator('td').nth(4)).not.toContainText(before);
  const after = (await row.locator('td').nth(4).innerText()).split('~')[1].trim();
  expect(Number(after.slice(0, 4))).toBe(Number(before.slice(0, 4)) + 1);

  // 검색
  await page.getByPlaceholder('회사명 / 사업자번호 검색').fill(name);
  await expect(page.getByRole('row').filter({ hasText: 'E2E 회사' })).toHaveCount(1);

  // 삭제
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: '삭제' }).click();
  await expect(row).toHaveCount(0);

  // 로그아웃 -> 이전 토큰은 서버에서 무효화되어 있어야 한다
  const token = await page.evaluate(() => localStorage.getItem('hr_admin_token'));
  // 로그아웃 요청은 UI 가 기다리지 않으므로(fire-and-forget) 서버가 응답한 뒤에 토큰을 검사해야 경합이 없다.
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/auth/logout')),
    page.getByRole('button', { name: '로그아웃' }).click(),
  ]);
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  const res = await page.request.get('/api/admin/tenants', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(401);
});

test('로그인: 5회 연속 실패하면 시도 제한(429)이 걸린다', async ({ page }) => {
  // 실제 admin 계정이 잠기지 않도록 임의 이메일 사용 (제한 키 = IP + 이메일)
  const email = `ratelimit-${Date.now()}@example.com`;
  await page.goto('/');
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호').fill('bad-password');
    // 에러 문구는 이전 시도의 것이 남아 있으므로 문구 대기만으로는 5회가 직렬 처리됐는지 알 수 없다. 응답을 직접 기다린다.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/auth/login')),
      page.getByRole('button', { name: '로그인' }).click(),
    ]);
    expect(resp.status()).toBe(401);
  }
  const [blocked] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/admin/auth/login')),
    page.getByRole('button', { name: '로그인' }).click(),
  ]);
  expect(blocked.status()).toBe(429);
  await expect(page.getByText('로그인 시도가 너무 많습니다')).toBeVisible();
});

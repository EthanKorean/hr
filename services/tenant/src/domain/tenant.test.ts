import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from './errors.js';
import { addMonths, assertValid, effectiveStatus, extendedEndDate, normalizeBizNo } from './tenant.js';

const base = { status: 'active' as const, startDate: '2026-01-01', endDate: '2026-12-31' };

test('effectiveStatus: 사용기간 안이면 사용중, 종료일 당일까지 포함한다', () => {
  assert.equal(effectiveStatus(base, '2026-06-15'), 'active');
  assert.equal(effectiveStatus(base, '2026-01-01'), 'active'); // 시작일 당일
  assert.equal(effectiveStatus(base, '2026-12-31'), 'active'); // 종료일 당일(포함)
});

test('effectiveStatus: 종료일 다음 날부터 만료, 시작일 전은 시작 예정', () => {
  assert.equal(effectiveStatus(base, '2027-01-01'), 'expired');
  assert.equal(effectiveStatus(base, '2025-12-31'), 'scheduled');
});

test('effectiveStatus: 수동 정지가 만료·시작 예정보다 우선한다', () => {
  const suspended = { ...base, status: 'suspended' as const };
  assert.equal(effectiveStatus(suspended, '2026-06-15'), 'suspended');
  assert.equal(effectiveStatus(suspended, '2030-01-01'), 'suspended'); // 만료됐어도
  assert.equal(effectiveStatus(suspended, '2020-01-01'), 'suspended'); // 시작 전이어도
});

test('addMonths: 말일 초과 시 말일로 보정한다', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); // 평년
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // 윤년
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-05-31', 6), '2026-11-30');
});

test('addMonths: 연도를 넘기고, 0개월과 12개월의 배수도 맞다', () => {
  assert.equal(addMonths('2025-11-30', 3), '2026-02-28');
  assert.equal(addMonths('2026-06-15', 0), '2026-06-15');
  assert.equal(addMonths('2026-06-15', 12), '2027-06-15');
  assert.equal(addMonths('2026-12-31', 24), '2028-12-31');
});

test('extendedEndDate: 아직 만료 전이면 현재 종료일 기준으로 연장한다', () => {
  assert.equal(extendedEndDate({ endDate: '2026-12-31' }, 1, '2026-06-15'), '2027-01-31');
});

test('extendedEndDate: 이미 만료됐으면 오늘 기준으로 연장한다', () => {
  assert.equal(extendedEndDate({ endDate: '2026-01-31' }, 1, '2026-06-15'), '2026-07-15');
});

test('extendedEndDate: 종료일이 오늘이면 오늘 기준(같은 날)이다', () => {
  assert.equal(extendedEndDate({ endDate: '2026-06-15' }, 2, '2026-06-15'), '2026-08-15');
});

test('extendedEndDate: 9999년을 넘기면 DB 오류가 아니라 검증 오류로 거절한다', () => {
  assert.equal(extendedEndDate({ endDate: '9999-11-30' }, 1, '2026-06-15'), '9999-12-30');
  assert.throws(() => extendedEndDate({ endDate: '9999-12-31' }, 1, '2026-06-15'), ValidationError);
});

test('assertValid: 종료일이 시작일보다 앞서면 검증 오류, 같은 날은 허용한다', () => {
  const p = { name: 'a', bizNo: '', contactName: '', contactEmail: '', contactPhone: '', maxEmployees: 1, status: 'active' as const };
  assert.throws(() => assertValid({ ...p, startDate: '2026-02-01', endDate: '2026-01-31' }), ValidationError);
  assert.doesNotThrow(() => assertValid({ ...p, startDate: '2026-02-01', endDate: '2026-02-01' }));
});

test('normalizeBizNo: 10자리면 000-00-00000 형식으로, 구분자는 무시한다', () => {
  assert.equal(normalizeBizNo('1234567890'), '123-45-67890');
  assert.equal(normalizeBizNo('123-45-67890'), '123-45-67890');
  assert.equal(normalizeBizNo(' 123 45 67890 '), '123-45-67890');
  assert.equal(normalizeBizNo('12345'), '12345'); // 10자리가 아니면 숫자만 남긴다
});

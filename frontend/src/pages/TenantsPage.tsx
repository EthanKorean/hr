import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, EffectiveStatus, Tenant, TenantInput } from '../api';

const LABEL: Record<EffectiveStatus, string> = {
  active: '사용중',
  scheduled: '시작 예정',
  expired: '만료',
  suspended: '정지',
};

// toISOString() 은 UTC 기준이라 KST 오전 9시 이전에는 하루 전 날짜가 나온다. 로컬 날짜로 포맷한다.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const plusYear = () => {
  const d = new Date();
  const month = d.getMonth();
  d.setFullYear(d.getFullYear() + 1);
  if (d.getMonth() !== month) d.setDate(0); // 2/29 + 1년 -> 3/1 로 넘어가지 않고 2/28 로 보정
  return ymd(d);
};
const emptyForm = (): TenantInput => ({
  name: '',
  bizNo: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  maxEmployees: 10,
  startDate: today(),
  endDate: plusYear(),
  status: 'active',
});

// 서버 응답(id/effectiveStatus 등 파생 필드 포함)에서 수정 폼이 다루는 필드만 복사한다.
const toForm = (t: Tenant): TenantInput => ({
  name: t.name,
  bizNo: t.bizNo,
  contactName: t.contactName,
  contactEmail: t.contactEmail,
  contactPhone: t.contactPhone,
  maxEmployees: t.maxEmployees,
  startDate: t.startDate,
  endDate: t.endDate,
  status: t.status,
});

export function TenantsPage({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [items, setItems] = useState<Tenant[]>([]);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // 입력이 멈춘 뒤(250ms) 반영되는 검색어: 키 입력마다 서버 조회하지 않도록
  const [editing, setEditingRaw] = useState<{ id?: number; form: TenantInput } | null>(null);
  const [msg, setMsg] = useState('');

  const setEditing: typeof setEditingRaw = (v) => {
    setMsg('');
    setEditingRaw(v);
  };

  const handle = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) return onUnauthorized();
      setMsg((e as Error).message);
    },
    [onUnauthorized],
  );

  // 가장 최근에 시작한 요청의 응답만 반영한다. (검색어 연타나 저장 직후 재조회 때 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않도록)
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    return api
      .listTenants(query)
      .then((r) => id === seq.current && setItems(r))
      .catch((e) => id === seq.current && handle(e));
  }, [query, handle]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const saving = useRef(false); // 저장 중 중복 제출(더블클릭/Enter 연타) 방지
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || saving.current) return;
    saving.current = true;
    try {
      editing.id ? await api.updateTenant(editing.id, editing.form) : await api.createTenant(editing.form);
      setEditing(null);
      setMsg('');
      load();
    } catch (err) {
      handle(err);
    } finally {
      saving.current = false;
    }
  };

  // 성공하면 이전 작업의 오류 메시지가 남아 있지 않도록 지우고 목록을 다시 불러온다.
  const reload = () => {
    setMsg('');
    return load();
  };

  const extend = (t: Tenant) => {
    const v = prompt(`'${t.name}' 사용기간을 몇 개월 연장할까요?`, '12');
    const months = Number(v);
    if (!v || !Number.isInteger(months) || months < 1) return;
    api.extendTenant(t.id, months).then(reload).catch(handle);
  };

  const remove = (t: Tenant) => {
    if (confirm(`'${t.name}' 고객사를 삭제할까요? 되돌릴 수 없습니다.`)) api.deleteTenant(t.id).then(reload).catch(handle);
  };

  const set = <K extends keyof TenantInput>(k: K, v: TenantInput[K]) =>
    setEditingRaw((s) => s && { ...s, form: { ...s.form, [k]: v } });

  return (
    <section>
      <div className="toolbar">
        <h2>고객사 관리</h2>
        <input placeholder="회사명 / 사업자번호 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEditing({ form: emptyForm() })}>+ 고객사 등록</button>
      </div>
      {msg && !editing && <p className="error">{msg}</p>}

      <table className="card">
        <thead>
          <tr><th>회사명</th><th>사업자번호</th><th>담당자</th><th>최대 인원</th><th>사용기간</th><th>상태</th><th /></tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.bizNo}</td>
              <td>{t.contactName}<br /><small>{t.contactEmail}</small></td>
              <td>{t.maxEmployees}</td>
              <td>{t.startDate} ~ {t.endDate}</td>
              <td><span className={`badge ${t.effectiveStatus}`}>{LABEL[t.effectiveStatus]}</span></td>
              <td className="actions">
                <button className="btn" onClick={() => extend(t)}>연장</button>
                <button className="btn" onClick={() => setEditing({ id: t.id, form: toForm(t) })}>수정</button>
                <button className="btn danger" onClick={() => remove(t)}>삭제</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={7} className="empty">{query ? '검색 결과가 없습니다.' : '등록된 고객사가 없습니다.'}</td></tr>}
        </tbody>
      </table>

      {editing && (
        // mousedown 으로 판별: 입력창에서 텍스트를 드래그하다 모달 밖에서 마우스를 놓아도 닫히지(입력 내용 유실) 않는다.
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <form className="modal card" onSubmit={save}>
            <h3>{editing.id ? '고객사 수정' : '고객사 등록'}</h3>
            <label>회사명<input value={editing.form.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label>사업자등록번호<input value={editing.form.bizNo} onChange={(e) => set('bizNo', e.target.value)} placeholder="000-00-00000" required /></label>
            <div className="row">
              <label>담당자명<input value={editing.form.contactName} onChange={(e) => set('contactName', e.target.value)} required /></label>
              <label>연락처<input value={editing.form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></label>
            </div>
            <label>담당자 이메일<input type="email" value={editing.form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} required /></label>
            <div className="row">
              <label>사용 시작일<input type="date" value={editing.form.startDate} onChange={(e) => set('startDate', e.target.value)} required /></label>
              <label>사용 종료일<input type="date" value={editing.form.endDate} onChange={(e) => set('endDate', e.target.value)} required /></label>
            </div>
            <div className="row">
              <label>최대 근로자 수<input type="number" min={1} step={1} value={editing.form.maxEmployees || ''} onChange={(e) => set('maxEmployees', Math.trunc(Number(e.target.value)))} required /></label>
              <label>상태
                <select value={editing.form.status} onChange={(e) => set('status', e.target.value as TenantInput['status'])}>
                  <option value="active">정상</option>
                  <option value="suspended">정지</option>
                </select>
              </label>
            </div>
            {msg && <p className="error">{msg}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>취소</button>
              <button className="btn primary">저장</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

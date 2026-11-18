import { FormEvent, useState } from 'react';
import { api, setToken } from '../api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.login(email, password);
      setToken(r.token);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login card" onSubmit={submit}>
      <h1>HR Admin</h1>
      <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
      <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
    </form>
  );
}

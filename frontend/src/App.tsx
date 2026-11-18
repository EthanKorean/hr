import { useCallback, useState } from 'react';
import { api, getToken, setToken } from './api';
import { LoginPage } from './pages/LoginPage';
import { TenantsPage } from './pages/TenantsPage';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const logout = useCallback(() => {
    api.logout(); // 서버에 토큰 무효화 요청 (결과는 기다리지 않음)
    setToken(null);
    setAuthed(false);
  }, []);
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  return (
    <div className="shell">
      <header className="topbar">
        <strong>HR Admin</strong>
        <nav><span className="nav-item active">고객사 관리</span></nav>
        <button className="btn ghost" onClick={logout}>로그아웃</button>
      </header>
      <main>
        <TenantsPage onUnauthorized={logout} />
      </main>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import './app-shell.css';

export type AppNav = 'accounts' | 'chat-records';

type AppShellProps = {
  active: AppNav;
  children: React.ReactNode;
};

function displayName(email: string, name?: string, username?: string) {
  if (name?.trim()) {
    return name.trim();
  }
  if (username?.trim()) {
    return username.trim();
  }
  return email.split('@')[0] ?? 'Admin';
}

export function AppShell({ active, children }: AppShellProps) {
  const { user, logout, authRequired } = useAuth();
  const label = user ? displayName(user.email, user.name, user.username) : 'Admin';
  const initial = label.charAt(0).toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CM</div>
          <div>
            <strong>ChatManager</strong>
            <span>LibreChat 扩展</span>
          </div>
        </div>
        <nav className="nav-section">
          <span className="nav-link muted">⌂ 仪表盘</span>
          <small>管理</small>
          <Link className={active === 'accounts' ? 'nav-link active' : 'nav-link'} href="/">
            ♚ 账户管理
          </Link>
          <Link
            className={active === 'chat-records' ? 'nav-link active' : 'nav-link'}
            href="/chat-records"
          >
            ☰ 聊天记录
          </Link>
          <span className="nav-link muted">⚙ 系统设置</span>
          <small>系统</small>
          <span className="nav-link muted">◉ 数据库管理</span>
          <span className="nav-link muted">▦ 操作日志</span>
          <span className="nav-link muted">⌘ API 管理</span>
        </nav>
        <div className="sidebar-footer">
          <div>
            <span>版本</span>
            <strong>v0.2.0</strong>
          </div>
          <em>● 在线</em>
        </div>
      </aside>

      <main className="main-panel">
        <header className="global-header">
          {authRequired && user ? (
            <div className="admin-chip">
              <button className="admin-chip-button" onClick={() => void logout()} type="button">
                <span>{initial}</span>
                {label} · 退出
              </button>
            </div>
          ) : (
            <div className="admin-chip">
              <span>{initial}</span>
              {label}
            </div>
          )}
        </header>
        {children}
      </main>
    </div>
  );
}

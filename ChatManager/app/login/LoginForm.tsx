'use client';

import { FormEvent, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import './login.css';

export default function LoginForm() {
  const { refresh } = useAuth();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? '登录失败');
        return;
      }

      await refresh();

      const target = redirect.startsWith('/') ? redirect : '/';
      window.location.assign(target);
    } catch {
      setError('无法连接服务器，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-mark">CM</div>
          <div>
            <strong>ChatManager</strong>
            <span>LibreChat 扩展控制台</span>
          </div>
        </div>

        <h1>管理员登录</h1>
        <p className="login-hint">使用具备 LibreChat 管理后台权限的账户登录</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            邮箱
            <input
              autoComplete="email"
              name="email"
              placeholder="admin@example.com"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              name="password"
              placeholder="请输入密码"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <button className="login-submit" disabled={busy} type="submit">
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

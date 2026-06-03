import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-loading">加载中…</div>}>
      <LoginForm />
    </Suspense>
  );
}

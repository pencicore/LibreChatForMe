'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SessionUser } from '@/lib/librechat-auth';

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  authRequired: boolean;
  user: SessionUser | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}

type SessionResponse = {
  authenticated: boolean;
  authRequired: boolean;
  user?: SessionUser;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    const data = (await response.json()) as SessionResponse;

    if (!response.ok || !data.authenticated) {
      setAuthenticated(false);
      setAuthRequired(data.authRequired ?? true);
      setUser(null);
      return;
    }

    setAuthenticated(true);
    setAuthRequired(data.authRequired);
    setUser(data.user ?? null);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/login', { method: 'DELETE', credentials: 'include' });
    setAuthenticated(false);
    setUser(null);
    router.replace('/login');
  }, [router]);

  const prevPathname = useRef(pathname);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await refresh();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const cameFromLogin = prevPathname.current === '/login' && pathname !== '/login';

    prevPathname.current = pathname;

    if (cameFromLogin) {
      setLoading(true);
      void refresh().finally(() => setLoading(false));
    }
  }, [pathname, refresh]);

  useEffect(() => {
    if (loading || pathname === '/login') {
      return;
    }

    if (authRequired && !authenticated) {
      const redirect = encodeURIComponent(pathname);
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [authRequired, authenticated, loading, pathname, router]);

  const value = useMemo(
    () => ({ loading, authenticated, authRequired, user, logout, refresh }),
    [authRequired, authenticated, loading, logout, refresh, user],
  );

  if (loading && pathname !== '/login') {
    return (
      <div className="auth-loading">
        <p>正在验证登录状态…</p>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
